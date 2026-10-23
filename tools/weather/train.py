#!/usr/bin/env python3
"""Trains the learned part of the mountain weather model and writes wxmodel-weights.js.

Fits quantile regression trees for the physical core's temperature residual.
The rain/snow logistic stays unchanged; this temperature pilot cannot validate a
precipitation classifier.

Validation includes unseen stations, later hours, and later hours at unseen stations.
Every split must beat the physical core on both row-weighted and station-balanced MAE.
There is no force override. A failed candidate never replaces shipped weights.

Usage:
  python3 tools/weather/train.py rows.csv --evaluate-only --report evaluation.json
Needs numpy and scikit-learn.
"""
import argparse, csv, datetime, hashlib, json, os, re, subprocess, sys

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
import sklearn

HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(HERE, '../../app/src/main/assets/web/js/wxmodel-weights.js')
QUANTILES = {'p10': 0.1, 'p50': 0.5, 'p90': 0.9}
TREE = dict(n_estimators=150, max_depth=3, learning_rate=0.05, min_samples_leaf=40, subsample=0.8, random_state=7)


def read_weights(path):
    src = open(path, encoding='utf-8').read()
    body = src[src.index('window.BcWxWeights = ') + len('window.BcWxWeights = '):].rstrip().rstrip(';')
    # The file is JavaScript, not JSON: quote bare keys and swap quotes before parsing.
    body = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', body).replace("'", '"')
    return json.loads(body)


def load(path, features):
    with open(path, encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        header = reader.fieldnames or []
        if len(header) != len(set(header)):
            sys.exit('duplicate column names in ' + path)
        rows = list(reader)
    if not rows:
        sys.exit('no rows in ' + path)
    missing = [f for f in features if f not in rows[0]]
    if missing:
        sys.exit('rows lack features ' + ', '.join(missing) + '; rebuild them with build_dataset.js')
    X = np.array([[float(r[f]) for f in features] for r in rows])
    y = np.array([float(r['residual']) for r in rows])
    groups = np.array([r['station'] for r in rows])
    if not np.isfinite(X).all() or not np.isfinite(y).all() or any(not g for g in groups):
        sys.exit('non-finite feature/target or empty station')
    keys = [(r['station'], r.get('timestamp', '')) for r in rows]
    if len(keys) != len(set(keys)):
        sys.exit('duplicate station/timestamp observations; rebuild clean rows')
    return rows, X, y, groups


def utc(value):
    stamp = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('timestamp requires an explicit UTC offset')
    return stamp.timestamp()


def chronology(rows):
    try:
        times = np.array([utc(r['timestamp']) for r in rows])
        issued = np.array([utc(r['forecast_update']) for r in rows])
    except (KeyError, ValueError) as err:
        sys.exit('valid observation and forecast-update timestamps required: ' + str(err))
    if np.any(issued >= times):
        sys.exit('forecast update must precede its target observation')
    hours = sorted(set(np.floor(times / 3600)))
    if len(hours) < 6:
        sys.exit('need at least six distinct hourly blocks for chronological validation')
    # Fixed before seeing targets: last 30% of hourly blocks, with a one-hour gap.
    cutoff = hours[int(len(hours) * 0.7)] * 3600
    early, late = times < cutoff - 3600, times >= cutoff
    return times, early, late, cutoff


def export_tree(est, scale):
    """sklearn regression tree to the app's flat nodes: [feature, threshold, left, right, value]."""
    t = est.tree_
    nodes = []
    for i in range(t.node_count):
        if t.children_left[i] == -1:
            nodes.append([-1, 0, 0, 0, round(float(t.value[i][0][0]) * scale, 10)])
        else:
            nodes.append([int(t.feature[i]), float(t.threshold[i]), int(t.children_left[i]), int(t.children_right[i]), 0])
    return nodes


def export_model(m):
    """A fitted GradientBoostingRegressor as a list of trees; the first is its constant start."""
    init = float(np.ravel(m.init_.predict(np.zeros((1, m.n_features_in_))))[0]) if hasattr(m.init_, 'predict') else 0.0
    trees = [[[-1, 0, 0, 0, round(init, 10)]]]
    for est in m.estimators_[:, 0]:
        trees.append(export_tree(est, m.learning_rate))
    return trees


def support_for(X, rows, selected):
    included = [rows[i] for i in np.flatnonzero(selected)]
    def limits(key):
        values = [float(row[key]) for row in included]
        return [min(values), max(values)]
    return {'sources': sorted(set(rows[i]['source'] for i in np.flatnonzero(selected))),
            'requiresTerrain': True, 'withoutStationAdjustment': True,
            'referenceTemperatureC': limits('ref_t'), 'targetElevationM': limits('target_z'),
            'bounds': [[float(a), float(b)] for a, b in zip(X[selected].min(axis=0), X[selected].max(axis=0))]}


def fit_predict_exported(X, y, rows, weights, train, test):
    fitted = {key: export_model(GradientBoostingRegressor(loss='quantile', alpha=alpha, **TREE).fit(X[train], y[train]))
              for key, alpha in QUANTILES.items()}
    bundle = {**weights, 'temp': fitted, 'support': support_for(X, rows, train)}
    payload = {'weights': bundle,
               'rows': [{'x': X[i].tolist(), 'source': rows[i]['source'], 'terrain': rows[i]['terrain_available'] == '1',
                         'ref_t': float(rows[i]['ref_t']), 'ref_z': float(rows[i]['ref_z'])}
                        for i in np.flatnonzero(test)]}
    result = subprocess.run(['node', os.path.join(HERE, 'predict_exported.js')], input=json.dumps(payload),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def leave_one_station_out(X, y, groups, rows, weights):
    stations = sorted(set(groups))
    pred = {k: np.zeros_like(y) for k in QUANTILES}
    pred['applied'] = np.zeros(len(y), dtype=bool)
    for s in stations:
        test = groups == s
        exported = fit_predict_exported(X, y, rows, weights, ~test, test)
        for key in pred:
            pred[key][test] = [row[key] for row in exported]
    return pred


def later_predictions(X, y, groups, early, late, rows, weights, unseen_station=False):
    pred = {k: np.full_like(y, np.nan) for k in QUANTILES}
    pred['applied'] = np.zeros(len(y), dtype=bool)
    targets = sorted(set(groups[late])) if unseen_station else [None]
    for station in targets:
        train = early & (groups != station) if unseen_station else early
        test = late & (groups == station) if unseen_station else late
        if train.sum() < 60 or len(set(groups[train])) < 5:
            raise ValueError('too few independent training rows/stations before the time cutoff')
        exported = fit_predict_exported(X, y, rows, weights, train, test)
        for key in pred:
            pred[key][test] = [row[key] for row in exported]
    return pred


def metrics(rows, y, groups, pred, selected):
    target, correction = y[selected], pred['p50'][selected]
    subset = groups[selected]
    core_error, model_error = np.abs(target), np.abs(target - correction)
    stations = sorted(set(subset))
    per_station = {s: {'rows': int((subset == s).sum()),
                      'coreMaeC': float(np.mean(core_error[subset == s])),
                      'correctedMaeC': float(np.mean(model_error[subset == s]))} for s in stations}
    low = np.minimum(pred['p10'][selected], correction)
    high = np.maximum(pred['p90'][selected], correction)
    original = np.array([float(r['observed']) for r in rows])[selected]
    actual_low = np.array([float(r['core_p10']) for r in rows])[selected] + low
    actual_high = np.array([float(r['core_p90']) for r in rows])[selected] + high
    baseline_low = np.array([float(r['core_p10']) for r in rows])[selected]
    baseline_high = np.array([float(r['core_p90']) for r in rows])[selected]
    result = {'rows': int(selected.sum()), 'stations': len(stations),
              'correctionAppliedRows': int(pred['applied'][selected].sum()),
              'coreMaeC': float(np.mean(core_error)), 'correctedMaeC': float(np.mean(model_error)),
              'coreStationMeanMaeC': float(np.mean([v['coreMaeC'] for v in per_station.values()])),
              'correctedStationMeanMaeC': float(np.mean([v['correctedMaeC'] for v in per_station.values()])),
              'residualBandCoverage': float(np.mean((target >= low) & (target <= high))),
              'coreDisplayedBandCoverage': float(np.mean((original >= baseline_low) & (original <= baseline_high))),
              'displayedBandCoverage': float(np.mean((original >= actual_low) & (original <= actual_high))),
              'perStation': per_station}
    result['passed'] = (result['correctedMaeC'] < result['coreMaeC']
                        and result['correctedStationMeanMaeC'] < result['coreStationMeanMaeC'])
    return result


def write(path, w):
    feats = json.dumps(w['features'])
    js = ("/* Weights for the mountain weather model (see wxmodel.js and tools/weather/).\n"
          "   Generated by tools/weather/train.py; do not edit by hand.\n\n"
          "   precip: rain/snow logistic, P(snow) = 1 / (1 + exp(a + b*T + c*RH)), T in C, RH in %.\n"
          "   temp:   quantile regression trees for the error of the physical core, at the 10th, 50th\n"
          "           and 90th percentiles, as flat node lists [feature, threshold, left, right, value]. */\n"
          "window.BcWxWeights = {\n"
          "  version: " + json.dumps(w['version']) + ",\n"
          "  trained: " + json.dumps(w['trained']) + ",\n"
          "  features: " + feats + ",\n"
          "  support: " + json.dumps(w.get('support')) + ",\n"
          "  precip: " + json.dumps(w['precip']) + ",\n"
          "  temp: " + json.dumps(w['temp'], separators=(',', ':')) + "\n"
          "};\n")
    with open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(js)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('rows')
    ap.add_argument('--out', default=WEIGHTS)
    ap.add_argument('--evaluate-only', action='store_true')
    ap.add_argument('--report', required=True, help='JSON evidence is written even when a candidate is rejected')
    args = ap.parse_args()

    w = read_weights(WEIGHTS)
    rows, X, y, groups = load(args.rows, w['features'])
    n_st = len(set(groups))
    print(f'{len(y)} rows from {n_st} stations')
    if n_st < 5:
        sys.exit('need at least 5 stations for a meaningful leave-one-station-out test')

    times, early, late, cutoff = chronology(rows)
    station_pred = leave_one_station_out(X, y, groups, rows, w)
    time_pred = later_predictions(X, y, groups, early, late, rows, w)
    both_pred = later_predictions(X, y, groups, early, late, rows, w, unseen_station=True)
    evaluation = {
        'heldOutStations': metrics(rows, y, groups, station_pred, np.ones(len(y), dtype=bool)),
        'laterHours': metrics(rows, y, groups, time_pred, late),
        'laterHoursUnseenStations': metrics(rows, y, groups, both_pred, late)}
    passed = all(part['passed'] for part in evaluation.values())
    report = {'accepted': passed, 'rows': len(rows), 'stations': n_st,
              'datasetSha256': hashlib.sha256(open(args.rows, 'rb').read()).hexdigest(),
              'sklearnVersion': sklearn.__version__, 'parameters': TREE,
              'firstObservationUTC': datetime.datetime.fromtimestamp(min(times), datetime.timezone.utc).isoformat(),
              'lastObservationUTC': datetime.datetime.fromtimestamp(max(times), datetime.timezone.utc).isoformat(),
              'chronologicalCutoffUTC': datetime.datetime.fromtimestamp(cutoff, datetime.timezone.utc).isoformat(),
              'gapHours': 1, 'chronologicalTrainingRows': int(early.sum()),
              'chronologicalTrainingStations': len(set(groups[early])),
              'heldOutStationPartitions': [{'testStation': station, 'trainRows': int((groups != station).sum()),
                                           'trainStations': n_st - 1, 'testRows': int((groups == station).sum())}
                                          for station in sorted(set(groups))],
              'laterUnseenStationPartitions': [{'testStation': station,
                                               'trainRows': int((early & (groups != station)).sum()),
                                               'trainStations': len(set(groups[early & (groups != station)])),
                                               'testRows': int((late & (groups == station)).sum())}
                                              for station in sorted(set(groups[late]))],
              'predictionPath': 'Exported JS trees and runtime support gate; support bounds are derived from each training partition only.',
              'sources': sorted(set(r['source'] for r in rows)), 'evaluation': evaluation,
              'precipitationRefitted': False,
              'scopeNote': 'Validation applies only to this dataset; single-day results do not establish seasonal or high-elevation-offset performance.'}
    with open(args.report, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, allow_nan=False)
    for name, result in evaluation.items():
        print(f"{name}: core {result['coreMaeC']:.3f} C, corrected {result['correctedMaeC']:.3f} C; {'PASS' if result['passed'] else 'FAIL'}")
    if not passed:
        sys.exit('candidate rejected by held-out validation; shipped weights unchanged')
    if args.evaluate_only:
        print('candidate passed; evaluation only, no weights written')
        return

    out = dict(w)
    out['temp'] = {k: export_model(GradientBoostingRegressor(loss='quantile', alpha=a, **TREE).fit(X, y)) for k, a in QUANTILES.items()}
    out['support'] = support_for(X, rows, np.ones(len(y), dtype=bool))
    stamp = datetime.date.today().isoformat()
    out['version'] = 'gbq-' + stamp
    out['trained'] = {'date': stamp, **report}
    write(args.out, out)
    print('wrote ' + args.out)


if __name__ == '__main__':
    main()
