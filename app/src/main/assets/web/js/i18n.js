/* Bristlecone strings: English (US), English (Canada), French (Canada), Spanish (US and Latin America).
   Brand voice: plain, specific, calm. No hype words. */
(function () {
  const en = {
    'app.name': 'Bristlecone',
    'app.tagline': 'Know the ground.',
    'app.subtag': 'Trail maps for the US and Canada, drawn from public data.',

    'nav.map': 'Map', 'nav.conditions': 'Conditions', 'nav.offline': 'Offline', 'nav.places': 'Places', 'nav.more': 'Settings',

    'search.placeholder': 'Search places in the US and Canada',
    'search.none': 'No matches. Try a trail, peak, park or town.',
    'search.searching': 'Searching…',
    'search.offline': 'Search needs a connection. Downloaded maps still work.',

    'loc.gps': 'GPS', 'loc.network': 'Network estimate', 'loc.estimate': 'Estimated position',
    'loc.none': 'Location off', 'loc.searching': 'Finding you…',
    'loc.estimateTitle': 'This position is an estimate',
    'loc.estimateBody': 'GPS is unavailable. Bristlecone is estimating from your steps, compass and barometer since your last good fix. The true position is likely inside the amber circle. Confirm against landmarks: trail junctions, signs, peaks, streams and ridgelines.',
    'loc.networkBody': 'GPS is unavailable. This position comes from nearby Wi-Fi and cell towers and may be off by {d}. Confirm against landmarks: trail junctions, signs, peaks, streams and ridgelines.',
    'loc.lookForLandmarks': 'Look for landmarks',
    'loc.snapped': 'Nearest trail shown',
    'loc.permission': 'Location permission is off. Turn it on in Android settings to see your position on the map.',
    'loc.gpsOff': 'GPS is off on this phone. Turn on Location for an accurate position.',
    'loc.walked': 'Estimated from {d} of walking since the last GPS fix.',
    'loc.stride': 'Step model trained on {n} GPS segments from your own walking.',
    'loc.strideNew': 'Step model is using its starting values. It learns your stride whenever GPS is clear.',

    'layers.title': 'Map layers', 'layers.base': 'Base map',
    'base.bristlecone': 'Bristlecone', 'base.bristlecone.d': 'Drawn for trail use. US and Canada.',
    'base.usgsTopo': 'USGS Topo', 'base.usgsTopo.d': 'US only. Official topographic map.',
    'base.usgsImagery': 'USGS Imagery', 'base.usgsImagery.d': 'US only. Aerial photos with labels.',
    'base.openTopo': 'OpenTopoMap', 'base.openTopo.d': 'US and Canada. Classic contour topo.',
    'base.canada': 'Canada Base Map', 'base.canada.d': 'Canada only. Natural Resources Canada.',
    'layers.trails': 'Trails',
    'trail.hiking': 'Hiking and walking', 'trail.ski': 'Ski runs and Nordic trails', 'trail.atv': 'ATV and off-highway',
    'trail.bike': 'Bike and mountain bike', 'trail.horse': 'Horse trails', 'trail.climbing': 'Climbing routes and crags',
    'trail.trailheads': 'Trailheads',
    'layers.terrain': 'Terrain', 'terrain.hillshade': 'Hillshade', 'terrain.contours': 'Contour lines', 'terrain.3d': '3D terrain',
    'layers.lands': 'Land boundaries',
    'lands.public': 'Public and protected lands',
    'lands.public.d': 'National and state parks, national forests, BLM land, wildlife refuges, provincial parks',
    'lands.tribal': 'Tribal and First Nations lands',
    'lands.tribal.d': 'US reservations and trust lands. Canadian reserves and settlement lands.',
    'lands.admin': 'State, provincial and national borders',
    'layers.hazards': 'Hazards', 'hazard.fire': 'Wildfire perimeters (US)', 'hazard.avalanche': 'Avalanche danger (in season)',
    'layers.zoomHint': 'Trail and land details appear as you zoom in.',

    'mgr.NPS': 'National Park Service', 'mgr.USFS': 'National Forest', 'mgr.BLM': 'Bureau of Land Management',
    'mgr.FWS': 'Wildlife refuge', 'mgr.STAT': 'State or provincial', 'mgr.LOC': 'Local', 'mgr.TRIB': 'Tribal or First Nations',
    'mgr.FED': 'Other federal', 'mgr.OTH': 'Other public', 'mgr.PC': 'Parks Canada', 'mgr.NGO': 'Conservation group',

    'cond.title': 'Conditions', 'cond.near': 'Near {place}', 'cond.mapCenter': 'the map center',
    'cond.refresh': 'Refresh', 'cond.newestFirst': 'Newest first',
    'cond.loading': 'Checking public sources…',
    'cond.none': 'No current reports from public sources here. No reports is not the same as all clear.',
    'cond.offline': 'Offline. Showing reports saved {age}.',
    'cond.sources': 'Sources checked', 'cond.sourceOk': '{n} items', 'cond.sourceFail': 'unavailable', 'cond.sourceNa': 'not covered here',
    'cond.justNow': 'just now', 'cond.minsAgo': '{n} min ago', 'cond.hoursAgo': '{n} h ago', 'cond.yesterday': 'yesterday', 'cond.daysAgo': '{n} days ago',
    'cond.recent': 'Last 48 hours', 'cond.week': 'This week', 'cond.month': 'This month', 'cond.older': 'Older',
    'cond.addReport': 'Add a field report', 'cond.read': 'Read more', 'cond.until': 'Until {t}',
    'cond.stale': 'Saved copy',

    'src.nws': 'National Weather Service', 'src.eccc': 'Environment and Climate Change Canada',
    'src.nps': 'National Park Service', 'src.avy': 'Avalanche.org', 'src.avcan': 'Avalanche Canada',
    'src.osm': 'Trail notes (OpenStreetMap)', 'src.fire': 'Wildfire perimeters (NIFC)', 'src.mine': 'Your field reports',

    'danger.0': 'No rating', 'danger.1': 'Low', 'danger.2': 'Moderate', 'danger.3': 'Considerable', 'danger.4': 'High', 'danger.5': 'Extreme',
    'avy.title': 'Avalanche danger: {level}', 'fire.title': 'Wildfire: {name}', 'fire.body': '{acres} acres. {contained}',
    'fire.contained': '{p}% contained.',

    'off.title': 'Offline maps',
    'off.intro': 'Download the map before you lose signal. Each download includes trails, trailheads, terrain, contours, land boundaries and the latest reports.',
    'off.downloadView': 'Download this view', 'off.name': 'Name', 'off.defaultName': 'Map near {place}',
    'off.detail': 'Detail', 'off.detail.standard': 'Standard (zoom 14)', 'off.detail.high': 'High (zoom 15)',
    'off.includeBase': 'Also save the current base map ({base})',
    'off.estimate': '{tiles} tiles, about {size}', 'off.tooBig': 'Too large for one download. Zoom in or lower the detail.',
    'off.tooSmall': 'Zoom out a little so the download covers more ground.',
    'off.start': 'Download', 'off.cancel': 'Cancel', 'off.delete': 'Delete', 'off.show': 'Show',
    'off.ready': 'Ready offline', 'off.partial': 'Partly downloaded. Download again to fill gaps.', 'off.downloading': 'Downloading {p}%',
    'off.cancelled': 'Cancelled',
    'off.none': 'No downloaded maps yet.', 'off.storage': 'Storage on this phone',
    'off.used': 'Map data: {cache}. Your notes and settings: {data}. Free: {free}.',
    'off.clearCache': 'Clear browsing cache', 'off.clearCacheNote': 'Downloaded maps are kept.',
    'off.export': 'Export', 'off.exportImage': 'Save map image', 'off.exportGpx': 'Export trails in view (GPX)',
    'off.noTrails': 'No trails loaded in this view yet. Zoom in and try again.',
    'off.saved': 'Saved.', 'off.deleteConfirm': 'Delete "{name}"? The map data is removed from this phone.',

    'pl.title': 'Places and field reports', 'pl.saveCenter': 'Pin the map center', 'pl.saveHere': 'Pin my location',
    'pl.none': 'Nothing saved yet. Press and hold the map to drop a pin.',
    'pl.note': 'Note', 'pl.name': 'Name', 'pl.pin': 'Pin', 'pl.report': 'Field report', 'pl.save': 'Save', 'pl.delete': 'Delete',
    'pl.show': 'Show', 'pl.edit': 'Edit', 'common.needsApp': 'This needs the Android app.', 'pl.share': 'Share', 'pl.type': 'Type', 'pl.newPin': 'New pin', 'pl.newReport': 'New field report',
    'pl.reportNote': 'Your reports stay on this phone (and in your backups). They are not uploaded anywhere.',
    'rep.conditions': 'Trail conditions', 'rep.blowdown': 'Blowdown', 'rep.water': 'Water source', 'rep.snow': 'Snow or ice',
    'rep.closure': 'Closure', 'rep.wildlife': 'Wildlife', 'rep.other': 'Other',

    'ft.trailhead': 'Trailhead', 'ft.address': 'Address', 'ft.nearestAddress': 'Nearest road address',
    'ft.noAddress': 'No road address here. Use the coordinates.', 'ft.lookingUp': 'Looking up the nearest address…',
    'ft.coords': 'Coordinates', 'ft.copy': 'Copy', 'ft.copied': 'Copied', 'ft.directions': 'Directions to here',
    'ft.conditions': 'Conditions here', 'ft.pin': 'Pin this', 'ft.difficulty': 'Difficulty', 'ft.surface': 'Surface',
    'ft.visibility': 'Trail visibility', 'ft.surveyed': 'Last surveyed', 'ft.access': 'Access', 'ft.partOf': 'Part of',
    'ft.elevation': 'Elevation', 'ft.manager': 'Managed by', 'ft.publicAccess': 'Public access', 'ft.source': 'Source',
    'ft.unnamed': 'Unnamed trail', 'ft.climbs': '{n} climbs', 'ft.grade': 'Grade', 'ft.length': 'Segment length',
    'ft.designation': 'Designation', 'ft.parking': 'Parking', 'ft.fee': 'Fee', 'ft.yes': 'Yes', 'ft.no': 'No',
    'ft.oneway': 'One way', 'ft.lit': 'Lit at night', 'ft.width': 'Width',

    'kind.hiking': 'Hiking trail', 'kind.footway': 'Footpath', 'kind.steps': 'Steps', 'kind.ski_downhill': 'Downhill ski run',
    'kind.ski_nordic': 'Nordic ski trail', 'kind.ski_other': 'Ski route', 'kind.atv': 'ATV or off-highway trail',
    'kind.bike': 'Bike trail', 'kind.horse': 'Horse trail', 'kind.via_ferrata': 'Via ferrata', 'kind.track': 'Track or forest road',
    'kind.climb': 'Climbing route', 'kind.crag': 'Crag', 'kind.peak': 'Peak', 'kind.land': 'Public land', 'kind.tribal': 'Tribal or First Nations land',
    'kind.place': 'Place', 'kind.pin': 'Pin', 'kind.report': 'Field report',

    'piste.novice': 'Beginner', 'piste.easy': 'Easy', 'piste.intermediate': 'Intermediate', 'piste.advanced': 'Advanced',
    'piste.expert': 'Expert', 'piste.freeride': 'Freeride', 'piste.extreme': 'Extreme',
    'sac.hiking': 'Easy hiking (T1)', 'sac.mountain_hiking': 'Mountain hiking (T2)', 'sac.demanding_mountain_hiking': 'Demanding mountain hiking (T3)',
    'sac.alpine_hiking': 'Alpine hiking (T4)', 'sac.demanding_alpine_hiking': 'Demanding alpine hiking (T5)', 'sac.difficult_alpine_hiking': 'Difficult alpine hiking (T6)',
    'vis.excellent': 'Excellent', 'vis.good': 'Good', 'vis.intermediate': 'Intermittent', 'vis.bad': 'Poor', 'vis.horrible': 'Very poor', 'vis.no': 'No visible trail',
    'access.open': 'Open', 'access.restricted': 'Restricted', 'access.closed': 'Closed', 'access.unknown': 'Unknown',

    'set.title': 'Settings', 'set.language': 'Language', 'set.appearance': 'Appearance',
    'appear.auto': 'Automatic', 'appear.auto.d': 'Light by day, dark after sunset at your location.',
    'appear.light': 'Light', 'appear.dark': 'Dark', 'appear.now': 'Now showing {mode}. Sunset {sunset}, sunrise {sunrise}.',
    'set.units': 'Units', 'units.imperial': 'Feet and miles', 'units.metric': 'Meters and kilometers',
    'set.keepAwake': 'Keep the screen on while the map is open',
    'set.npsKey': 'National Park Service API key (optional)',
    'set.npsKeyNote': 'The shared demo key has low hourly limits. A free key from developer.nps.gov raises them.',
    'set.strideReset': 'Reset step model',
    'set.backup': 'Backup',
    'backup.drive': 'Back up to Google Drive',
    'backup.driveNote': 'Opens the Android file picker. Choose Google Drive (or any folder) as the destination. Everything else stays on this phone.',
    'backup.includeMaps': 'Include downloaded maps (larger file)',
    'backup.restore': 'Restore from a backup', 'backup.done': 'Backup saved ({n} files).', 'restore.done': 'Restored {n} files. Reloading.',
    'file.failed': 'That did not work: {e}', 'file.cancelled': 'Cancelled.',
    'about.title': 'About Bristlecone',
    'about.story': 'The Great Basin bristlecone pine grows on high, dry ground where little else will. It grows slowly, keeps a clear record of every year it stands, and has done so for thousands of years. Bristlecone the app is built on the same idea: steady, accurate and plain about what it knows. Every line on the map comes from public data and is redrawn for the trail. Reports are sorted newest first. When the app is estimating your position, it tells you.',
    'about.estimates': 'How position estimates work',
    'about.estimatesBody': 'With a clear GPS fix, Bristlecone uses it directly and quietly learns the length of your stride at different paces and grades. If GPS drops out, it tries Wi-Fi and cell location, then counts your steps and follows your compass heading from the last good fix, using that learned stride. The amber circle grows as the estimate ages. Treat it as a guide and confirm with landmarks.',
    'about.credits': 'Data sources and credits', 'about.maker': 'Made by H.M. Jackson.', 'about.version': 'Version {v}',
    'about.privacy': 'No account. No tracking. Your location never leaves the phone except as map requests to the public data sources listed here.',

    'note.1': 'Bristlecone pines can live for more than 4,000 years on thin, rocky soil.',
    'note.2': 'Download your map before the trailhead. Bristlecone works with no signal.',
    'note.3': 'Reports are sorted newest first, and old reports are labeled as old.',
    'note.4': 'When GPS drops out, Bristlecone estimates your position and says so.',
    'note.5': 'Contour lines are drawn on the phone from public elevation data, in your units.',
    'note.6': 'Trailheads with no street address show coordinates you can copy or share.',
    'note.label': 'Field note',

    'common.close': 'Close', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.ok': 'OK', 'common.loading': 'Loading…',
    'toast.offline': 'No connection. Using map data saved on this phone.', 'toast.online': 'Back online.',
    'toast.pinSaved': 'Pin saved.', 'toast.reportSaved': 'Field report saved.', 'toast.downloadStarted': 'Download started. You can keep using the map.',
    'toast.downloadDone': '"{name}" is ready offline.', 'toast.locating': 'Finding your position…',
    'export.watermark': 'Bristlecone · Know the ground.',
    'unit.ft': 'ft', 'unit.mi': 'mi', 'unit.m': 'm', 'unit.km': 'km'
  };

  const enCA = Object.assign({}, en, {
    'units.metric': 'Metres and kilometres',
    'note.3': 'Reports are sorted newest first, and old reports are labelled as old.',
    'mgr.STAT': 'Provincial or state',
    'search.placeholder': 'Search places in Canada and the US',
    'app.subtag': 'Trail maps for Canada and the US, drawn from public data.',
    'lands.admin': 'Provincial, state and national borders'
  });

  const fr = {
    'app.name': 'Bristlecone',
    'app.tagline': 'Connaître le terrain.',
    'app.subtag': 'Cartes de sentiers du Canada et des États-Unis, tracées à partir de données publiques.',

    'nav.map': 'Carte', 'nav.conditions': 'Conditions', 'nav.offline': 'Hors ligne', 'nav.places': 'Lieux', 'nav.more': 'Réglages',

    'search.placeholder': 'Rechercher un lieu au Canada ou aux États-Unis',
    'search.none': 'Aucun résultat. Essayez un sentier, un sommet, un parc ou une ville.',
    'search.searching': 'Recherche…',
    'search.offline': 'La recherche exige une connexion. Les cartes téléchargées fonctionnent toujours.',

    'loc.gps': 'GPS', 'loc.network': 'Estimation réseau', 'loc.estimate': 'Position estimée',
    'loc.none': 'Localisation désactivée', 'loc.searching': 'Recherche de votre position…',
    'loc.estimateTitle': 'Cette position est une estimation',
    'loc.estimateBody': 'Le GPS est indisponible. Bristlecone estime votre position à partir de vos pas, de la boussole et du baromètre depuis votre dernier point fiable. Votre position réelle se trouve probablement dans le cercle ambré. Vérifiez à l’aide de repères : jonctions de sentiers, panneaux, sommets, cours d’eau et crêtes.',
    'loc.networkBody': 'Le GPS est indisponible. Cette position provient des réseaux Wi-Fi et des antennes cellulaires à proximité et peut être décalée de {d}. Vérifiez à l’aide de repères : jonctions de sentiers, panneaux, sommets, cours d’eau et crêtes.',
    'loc.lookForLandmarks': 'Cherchez des repères',
    'loc.snapped': 'Sentier le plus proche affiché',
    'loc.permission': 'L’autorisation de localisation est désactivée. Activez-la dans les réglages Android pour voir votre position sur la carte.',
    'loc.gpsOff': 'Le GPS est désactivé sur ce téléphone. Activez la localisation pour une position précise.',
    'loc.walked': 'Estimation basée sur {d} de marche depuis le dernier point GPS.',
    'loc.stride': 'Modèle de pas entraîné sur {n} segments GPS de votre propre marche.',
    'loc.strideNew': 'Le modèle de pas utilise ses valeurs de départ. Il apprend votre foulée chaque fois que le GPS est clair.',

    'layers.title': 'Couches de la carte', 'layers.base': 'Fond de carte',
    'base.bristlecone': 'Bristlecone', 'base.bristlecone.d': 'Conçue pour les sentiers. Canada et États-Unis.',
    'base.usgsTopo': 'USGS Topo', 'base.usgsTopo.d': 'États-Unis seulement. Carte topographique officielle.',
    'base.usgsImagery': 'Imagerie USGS', 'base.usgsImagery.d': 'États-Unis seulement. Photos aériennes avec étiquettes.',
    'base.openTopo': 'OpenTopoMap', 'base.openTopo.d': 'Canada et États-Unis. Topo classique à courbes de niveau.',
    'base.canada': 'Carte de base du Canada', 'base.canada.d': 'Canada seulement. Ressources naturelles Canada.',
    'layers.trails': 'Sentiers',
    'trail.hiking': 'Randonnée et marche', 'trail.ski': 'Pistes de ski alpin et de fond', 'trail.atv': 'VTT et hors route',
    'trail.bike': 'Vélo et vélo de montagne', 'trail.horse': 'Sentiers équestres', 'trail.climbing': 'Voies et parois d’escalade',
    'trail.trailheads': 'Points de départ',
    'layers.terrain': 'Relief', 'terrain.hillshade': 'Ombrage du relief', 'terrain.contours': 'Courbes de niveau', 'terrain.3d': 'Relief 3D',
    'layers.lands': 'Limites territoriales',
    'lands.public': 'Terres publiques et protégées',
    'lands.public.d': 'Parcs nationaux et provinciaux, forêts nationales, terres du BLM, réserves fauniques',
    'lands.tribal': 'Terres des Premières Nations et tribales',
    'lands.tribal.d': 'Réserves et terres de fiducie aux États-Unis. Réserves et terres visées par un règlement au Canada.',
    'lands.admin': 'Frontières provinciales, étatiques et nationales',
    'layers.hazards': 'Dangers', 'hazard.fire': 'Périmètres de feux de forêt (É.-U.)', 'hazard.avalanche': 'Danger d’avalanche (en saison)',
    'layers.zoomHint': 'Les détails des sentiers et des terres apparaissent en zoomant.',

    'mgr.NPS': 'National Park Service', 'mgr.USFS': 'Forêt nationale (É.-U.)', 'mgr.BLM': 'Bureau of Land Management',
    'mgr.FWS': 'Réserve faunique', 'mgr.STAT': 'Provincial ou étatique', 'mgr.LOC': 'Local', 'mgr.TRIB': 'Premières Nations ou tribal',
    'mgr.FED': 'Autre fédéral', 'mgr.OTH': 'Autre public', 'mgr.PC': 'Parcs Canada', 'mgr.NGO': 'Organisme de conservation',

    'cond.title': 'Conditions', 'cond.near': 'Près de {place}', 'cond.mapCenter': 'le centre de la carte',
    'cond.refresh': 'Actualiser', 'cond.newestFirst': 'Les plus récents d’abord',
    'cond.loading': 'Consultation des sources publiques…',
    'cond.none': 'Aucun rapport actuel des sources publiques ici. L’absence de rapport ne veut pas dire que tout est dégagé.',
    'cond.offline': 'Hors ligne. Rapports enregistrés {age}.',
    'cond.sources': 'Sources consultées', 'cond.sourceOk': '{n} éléments', 'cond.sourceFail': 'indisponible', 'cond.sourceNa': 'ne couvre pas cette zone',
    'cond.justNow': 'à l’instant', 'cond.minsAgo': 'il y a {n} min', 'cond.hoursAgo': 'il y a {n} h', 'cond.yesterday': 'hier', 'cond.daysAgo': 'il y a {n} jours',
    'cond.recent': 'Dernières 48 heures', 'cond.week': 'Cette semaine', 'cond.month': 'Ce mois-ci', 'cond.older': 'Plus anciens',
    'cond.addReport': 'Ajouter un rapport de terrain', 'cond.read': 'Lire la suite', 'cond.until': 'Jusqu’à {t}',
    'cond.stale': 'Copie enregistrée',

    'src.nws': 'National Weather Service (É.-U.)', 'src.eccc': 'Environnement et Changement climatique Canada',
    'src.nps': 'National Park Service', 'src.avy': 'Avalanche.org', 'src.avcan': 'Avalanche Canada',
    'src.osm': 'Notes de sentier (OpenStreetMap)', 'src.fire': 'Périmètres de feux (NIFC)', 'src.mine': 'Vos rapports de terrain',

    'danger.0': 'Aucune cote', 'danger.1': 'Faible', 'danger.2': 'Modéré', 'danger.3': 'Considérable', 'danger.4': 'Élevé', 'danger.5': 'Extrême',
    'avy.title': 'Danger d’avalanche : {level}', 'fire.title': 'Feu de forêt : {name}', 'fire.body': '{acres} acres. {contained}',
    'fire.contained': 'Maîtrisé à {p} %.',

    'off.title': 'Cartes hors ligne',
    'off.intro': 'Téléchargez la carte avant de perdre le signal. Chaque téléchargement comprend les sentiers, les points de départ, le relief, les courbes de niveau, les limites territoriales et les derniers rapports.',
    'off.downloadView': 'Télécharger cette vue', 'off.name': 'Nom', 'off.defaultName': 'Carte près de {place}',
    'off.detail': 'Niveau de détail', 'off.detail.standard': 'Standard (zoom 14)', 'off.detail.high': 'Élevé (zoom 15)',
    'off.includeBase': 'Enregistrer aussi le fond de carte actuel ({base})',
    'off.estimate': '{tiles} tuiles, environ {size}', 'off.tooBig': 'Trop grand pour un seul téléchargement. Zoomez ou réduisez le détail.',
    'off.tooSmall': 'Dézoomez un peu pour couvrir plus de terrain.',
    'off.start': 'Télécharger', 'off.cancel': 'Annuler', 'off.delete': 'Supprimer', 'off.show': 'Afficher',
    'off.ready': 'Prête hors ligne', 'off.partial': 'Téléchargement partiel. Relancez pour combler les manques.', 'off.downloading': 'Téléchargement {p} %',
    'off.cancelled': 'Annulé',
    'off.none': 'Aucune carte téléchargée pour l’instant.', 'off.storage': 'Stockage sur ce téléphone',
    'off.used': 'Données cartographiques : {cache}. Vos notes et réglages : {data}. Libre : {free}.',
    'off.clearCache': 'Vider le cache de navigation', 'off.clearCacheNote': 'Les cartes téléchargées sont conservées.',
    'off.export': 'Exporter', 'off.exportImage': 'Enregistrer une image de la carte', 'off.exportGpx': 'Exporter les sentiers visibles (GPX)',
    'off.noTrails': 'Aucun sentier chargé dans cette vue. Zoomez et réessayez.',
    'off.saved': 'Enregistré.', 'off.deleteConfirm': 'Supprimer « {name} »? Les données cartographiques seront retirées du téléphone.',

    'pl.title': 'Lieux et rapports de terrain', 'pl.saveCenter': 'Épingler le centre de la carte', 'pl.saveHere': 'Épingler ma position',
    'pl.none': 'Rien d’enregistré. Appuyez longuement sur la carte pour placer une épingle.',
    'pl.note': 'Note', 'pl.name': 'Nom', 'pl.pin': 'Épingle', 'pl.report': 'Rapport de terrain', 'pl.save': 'Enregistrer', 'pl.delete': 'Supprimer',
    'pl.show': 'Afficher', 'pl.edit': 'Modifier', 'common.needsApp': 'Cette fonction exige l’application Android.', 'pl.share': 'Partager', 'pl.type': 'Type', 'pl.newPin': 'Nouvelle épingle', 'pl.newReport': 'Nouveau rapport de terrain',
    'pl.reportNote': 'Vos rapports restent sur ce téléphone (et dans vos sauvegardes). Ils ne sont téléversés nulle part.',
    'rep.conditions': 'État du sentier', 'rep.blowdown': 'Chablis', 'rep.water': 'Point d’eau', 'rep.snow': 'Neige ou glace',
    'rep.closure': 'Fermeture', 'rep.wildlife': 'Faune', 'rep.other': 'Autre',

    'ft.trailhead': 'Point de départ', 'ft.address': 'Adresse', 'ft.nearestAddress': 'Adresse routière la plus proche',
    'ft.noAddress': 'Aucune adresse routière ici. Utilisez les coordonnées.', 'ft.lookingUp': 'Recherche de l’adresse la plus proche…',
    'ft.coords': 'Coordonnées', 'ft.copy': 'Copier', 'ft.copied': 'Copié', 'ft.directions': 'Itinéraire jusqu’ici',
    'ft.conditions': 'Conditions ici', 'ft.pin': 'Épingler', 'ft.difficulty': 'Difficulté', 'ft.surface': 'Surface',
    'ft.visibility': 'Visibilité du sentier', 'ft.surveyed': 'Dernier relevé', 'ft.access': 'Accès', 'ft.partOf': 'Fait partie de',
    'ft.elevation': 'Altitude', 'ft.manager': 'Géré par', 'ft.publicAccess': 'Accès public', 'ft.source': 'Source',
    'ft.unnamed': 'Sentier sans nom', 'ft.climbs': '{n} voies', 'ft.grade': 'Cotation', 'ft.length': 'Longueur du segment',
    'ft.designation': 'Désignation', 'ft.parking': 'Stationnement', 'ft.fee': 'Frais', 'ft.yes': 'Oui', 'ft.no': 'Non',
    'ft.oneway': 'Sens unique', 'ft.lit': 'Éclairé la nuit', 'ft.width': 'Largeur',

    'kind.hiking': 'Sentier de randonnée', 'kind.footway': 'Sentier piétonnier', 'kind.steps': 'Escalier', 'kind.ski_downhill': 'Piste de ski alpin',
    'kind.ski_nordic': 'Piste de ski de fond', 'kind.ski_other': 'Itinéraire de ski', 'kind.atv': 'Sentier de VTT ou hors route',
    'kind.bike': 'Piste cyclable', 'kind.horse': 'Sentier équestre', 'kind.via_ferrata': 'Via ferrata', 'kind.track': 'Chemin ou route forestière',
    'kind.climb': 'Voie d’escalade', 'kind.crag': 'Paroi d’escalade', 'kind.peak': 'Sommet', 'kind.land': 'Terre publique', 'kind.tribal': 'Terre des Premières Nations ou tribale',
    'kind.place': 'Lieu', 'kind.pin': 'Épingle', 'kind.report': 'Rapport de terrain',

    'piste.novice': 'Débutant', 'piste.easy': 'Facile', 'piste.intermediate': 'Intermédiaire', 'piste.advanced': 'Avancé',
    'piste.expert': 'Expert', 'piste.freeride': 'Hors-piste', 'piste.extreme': 'Extrême',
    'sac.hiking': 'Randonnée facile (T1)', 'sac.mountain_hiking': 'Randonnée en montagne (T2)', 'sac.demanding_mountain_hiking': 'Randonnée en montagne exigeante (T3)',
    'sac.alpine_hiking': 'Randonnée alpine (T4)', 'sac.demanding_alpine_hiking': 'Randonnée alpine exigeante (T5)', 'sac.difficult_alpine_hiking': 'Randonnée alpine difficile (T6)',
    'vis.excellent': 'Excellente', 'vis.good': 'Bonne', 'vis.intermediate': 'Intermittente', 'vis.bad': 'Mauvaise', 'vis.horrible': 'Très mauvaise', 'vis.no': 'Aucun sentier visible',
    'access.open': 'Ouvert', 'access.restricted': 'Restreint', 'access.closed': 'Fermé', 'access.unknown': 'Inconnu',

    'set.title': 'Réglages', 'set.language': 'Langue', 'set.appearance': 'Apparence',
    'appear.auto': 'Automatique', 'appear.auto.d': 'Clair le jour, sombre après le coucher du soleil à votre position.',
    'appear.light': 'Clair', 'appear.dark': 'Sombre', 'appear.now': 'Mode actuel : {mode}. Coucher du soleil {sunset}, lever {sunrise}.',
    'set.units': 'Unités', 'units.imperial': 'Pieds et milles', 'units.metric': 'Mètres et kilomètres',
    'set.keepAwake': 'Garder l’écran allumé quand la carte est ouverte',
    'set.npsKey': 'Clé API du National Park Service (facultative)',
    'set.npsKeyNote': 'La clé de démonstration partagée a des limites horaires basses. Une clé gratuite de developer.nps.gov les augmente.',
    'set.strideReset': 'Réinitialiser le modèle de pas',
    'set.backup': 'Sauvegarde',
    'backup.drive': 'Sauvegarder dans Google Drive',
    'backup.driveNote': 'Ouvre le sélecteur de fichiers Android. Choisissez Google Drive (ou tout autre dossier) comme destination. Tout le reste demeure sur ce téléphone.',
    'backup.includeMaps': 'Inclure les cartes téléchargées (fichier plus lourd)',
    'backup.restore': 'Restaurer une sauvegarde', 'backup.done': 'Sauvegarde enregistrée ({n} fichiers).', 'restore.done': '{n} fichiers restaurés. Rechargement.',
    'file.failed': 'Échec : {e}', 'file.cancelled': 'Annulé.',
    'about.title': 'À propos de Bristlecone',
    'about.story': 'Le pin de Bristlecone du Grand Bassin pousse sur des terrains hauts et secs où peu d’autres arbres survivent. Il croît lentement, garde une trace nette de chaque année vécue, et ce, depuis des millénaires. L’application Bristlecone repose sur la même idée : constante, précise et franche sur ce qu’elle sait. Chaque ligne de la carte provient de données publiques et est redessinée pour le sentier. Les rapports sont classés du plus récent au plus ancien. Quand l’application estime votre position, elle vous le dit.',
    'about.estimates': 'Comment fonctionnent les estimations de position',
    'about.estimatesBody': 'Avec un bon signal GPS, Bristlecone l’utilise directement et apprend discrètement la longueur de votre foulée selon le rythme et la pente. Si le GPS décroche, l’application essaie la localisation Wi-Fi et cellulaire, puis compte vos pas et suit le cap de la boussole depuis le dernier point fiable, en utilisant cette foulée apprise. Le cercle ambré grandit à mesure que l’estimation vieillit. Considérez-la comme un guide et confirmez avec des repères.',
    'about.credits': 'Sources de données et mentions', 'about.maker': 'Conçu par H.M. Jackson.', 'about.version': 'Version {v}',
    'about.privacy': 'Aucun compte. Aucun pistage. Votre position ne quitte le téléphone que sous forme de requêtes cartographiques vers les sources publiques énumérées ici.',

    'note.1': 'Les pins de Bristlecone peuvent vivre plus de 4 000 ans sur un sol mince et rocailleux.',
    'note.2': 'Téléchargez la carte avant d’arriver au point de départ. Bristlecone fonctionne sans signal.',
    'note.3': 'Les rapports sont classés du plus récent au plus ancien, et les vieux rapports sont indiqués comme tels.',
    'note.4': 'Quand le GPS décroche, Bristlecone estime votre position et vous le dit.',
    'note.5': 'Les courbes de niveau sont tracées sur le téléphone à partir de données d’altitude publiques, dans vos unités.',
    'note.6': 'Les points de départ sans adresse affichent des coordonnées à copier ou à partager.',
    'note.label': 'Note de terrain',

    'common.close': 'Fermer', 'common.cancel': 'Annuler', 'common.save': 'Enregistrer', 'common.ok': 'OK', 'common.loading': 'Chargement…',
    'toast.offline': 'Aucune connexion. Utilisation des données enregistrées sur ce téléphone.', 'toast.online': 'Connexion rétablie.',
    'toast.pinSaved': 'Épingle enregistrée.', 'toast.reportSaved': 'Rapport de terrain enregistré.', 'toast.downloadStarted': 'Téléchargement lancé. Vous pouvez continuer à utiliser la carte.',
    'toast.downloadDone': '« {name} » est prête hors ligne.', 'toast.locating': 'Recherche de votre position…',
    'export.watermark': 'Bristlecone · Connaître le terrain.',
    'unit.ft': 'pi', 'unit.mi': 'mi', 'unit.m': 'm', 'unit.km': 'km'
  };

  const es = {
    'app.name': 'Bristlecone',
    'app.tagline': 'Conoce el terreno.',
    'app.subtag': 'Mapas de senderos de Estados Unidos y Canadá, trazados con datos públicos.',

    'nav.map': 'Mapa', 'nav.conditions': 'Condiciones', 'nav.offline': 'Sin conexión', 'nav.places': 'Lugares', 'nav.more': 'Ajustes',

    'search.placeholder': 'Busca lugares en EE. UU. y Canadá',
    'search.none': 'Sin resultados. Prueba con un sendero, cumbre, parque o pueblo.',
    'search.searching': 'Buscando…',
    'search.offline': 'La búsqueda necesita conexión. Los mapas descargados siguen funcionando.',

    'loc.gps': 'GPS', 'loc.network': 'Estimación por red', 'loc.estimate': 'Posición estimada',
    'loc.none': 'Ubicación desactivada', 'loc.searching': 'Buscando tu posición…',
    'loc.estimateTitle': 'Esta posición es una estimación',
    'loc.estimateBody': 'El GPS no está disponible. Bristlecone está estimando tu posición con tus pasos, la brújula y el barómetro desde tu último punto confiable. Lo más probable es que estés dentro del círculo ámbar. Confírmalo con puntos de referencia: cruces de senderos, letreros, cumbres, arroyos y crestas.',
    'loc.networkBody': 'El GPS no está disponible. Esta posición viene de redes Wi-Fi y antenas de telefonía cercanas y puede tener un error de {d}. Confírmala con puntos de referencia: cruces de senderos, letreros, cumbres, arroyos y crestas.',
    'loc.lookForLandmarks': 'Busca puntos de referencia',
    'loc.snapped': 'Se muestra el sendero más cercano',
    'loc.permission': 'El permiso de ubicación está desactivado. Actívalo en los ajustes de Android para ver tu posición en el mapa.',
    'loc.gpsOff': 'El GPS está apagado en este teléfono. Activa la ubicación para obtener una posición precisa.',
    'loc.walked': 'Estimado a partir de {d} de caminata desde el último punto GPS.',
    'loc.stride': 'Modelo de pasos entrenado con {n} tramos GPS de tu propia caminata.',
    'loc.strideNew': 'El modelo de pasos usa sus valores iniciales. Aprende tu zancada cada vez que el GPS está despejado.',

    'layers.title': 'Capas del mapa', 'layers.base': 'Mapa base',
    'base.bristlecone': 'Bristlecone', 'base.bristlecone.d': 'Diseñado para senderos. EE. UU. y Canadá.',
    'base.usgsTopo': 'USGS Topo', 'base.usgsTopo.d': 'Solo EE. UU. Mapa topográfico oficial.',
    'base.usgsImagery': 'Imágenes USGS', 'base.usgsImagery.d': 'Solo EE. UU. Fotos aéreas con etiquetas.',
    'base.openTopo': 'OpenTopoMap', 'base.openTopo.d': 'EE. UU. y Canadá. Topográfico clásico con curvas de nivel.',
    'base.canada': 'Mapa base de Canadá', 'base.canada.d': 'Solo Canadá. Recursos Naturales de Canadá.',
    'layers.trails': 'Senderos',
    'trail.hiking': 'Senderismo y caminata', 'trail.ski': 'Pistas de esquí alpino y de fondo', 'trail.atv': 'Cuatrimotos y todoterreno',
    'trail.bike': 'Bicicleta y bicicleta de montaña', 'trail.horse': 'Senderos ecuestres', 'trail.climbing': 'Vías y zonas de escalada',
    'trail.trailheads': 'Inicios de sendero',
    'layers.terrain': 'Relieve', 'terrain.hillshade': 'Sombreado del relieve', 'terrain.contours': 'Curvas de nivel', 'terrain.3d': 'Relieve 3D',
    'layers.lands': 'Límites de tierras',
    'lands.public': 'Tierras públicas y protegidas',
    'lands.public.d': 'Parques nacionales y estatales, bosques nacionales, tierras del BLM, refugios de vida silvestre, parques provinciales',
    'lands.tribal': 'Tierras tribales y de las Primeras Naciones',
    'lands.tribal.d': 'Reservas y tierras en fideicomiso en EE. UU. Reservas y tierras de acuerdos en Canadá.',
    'lands.admin': 'Fronteras estatales, provinciales y nacionales',
    'layers.hazards': 'Peligros', 'hazard.fire': 'Perímetros de incendios (EE. UU.)', 'hazard.avalanche': 'Peligro de avalanchas (en temporada)',
    'layers.zoomHint': 'Los detalles de senderos y tierras aparecen al acercarte.',

    'mgr.NPS': 'Servicio de Parques Nacionales', 'mgr.USFS': 'Bosque Nacional', 'mgr.BLM': 'Oficina de Administración de Tierras (BLM)',
    'mgr.FWS': 'Refugio de vida silvestre', 'mgr.STAT': 'Estatal o provincial', 'mgr.LOC': 'Local', 'mgr.TRIB': 'Tribal o de las Primeras Naciones',
    'mgr.FED': 'Otro federal', 'mgr.OTH': 'Otro público', 'mgr.PC': 'Parques de Canadá', 'mgr.NGO': 'Organización de conservación',

    'cond.title': 'Condiciones', 'cond.near': 'Cerca de {place}', 'cond.mapCenter': 'el centro del mapa',
    'cond.refresh': 'Actualizar', 'cond.newestFirst': 'Lo más reciente primero',
    'cond.loading': 'Consultando fuentes públicas…',
    'cond.none': 'No hay reportes actuales de fuentes públicas aquí. Que no haya reportes no significa que todo esté despejado.',
    'cond.offline': 'Sin conexión. Mostrando reportes guardados {age}.',
    'cond.sources': 'Fuentes consultadas', 'cond.sourceOk': '{n} elementos', 'cond.sourceFail': 'no disponible', 'cond.sourceNa': 'no cubre esta zona',
    'cond.justNow': 'ahora mismo', 'cond.minsAgo': 'hace {n} min', 'cond.hoursAgo': 'hace {n} h', 'cond.yesterday': 'ayer', 'cond.daysAgo': 'hace {n} días',
    'cond.recent': 'Últimas 48 horas', 'cond.week': 'Esta semana', 'cond.month': 'Este mes', 'cond.older': 'Más antiguos',
    'cond.addReport': 'Agregar un reporte de campo', 'cond.read': 'Leer más', 'cond.until': 'Hasta {t}',
    'cond.stale': 'Copia guardada',

    'src.nws': 'Servicio Meteorológico Nacional (EE. UU.)', 'src.eccc': 'Medio Ambiente y Cambio Climático Canadá',
    'src.nps': 'Servicio de Parques Nacionales', 'src.avy': 'Avalanche.org', 'src.avcan': 'Avalanche Canada',
    'src.osm': 'Notas de sendero (OpenStreetMap)', 'src.fire': 'Perímetros de incendios (NIFC)', 'src.mine': 'Tus reportes de campo',

    'danger.0': 'Sin nivel', 'danger.1': 'Bajo', 'danger.2': 'Moderado', 'danger.3': 'Considerable', 'danger.4': 'Alto', 'danger.5': 'Extremo',
    'avy.title': 'Peligro de avalanchas: {level}', 'fire.title': 'Incendio: {name}', 'fire.body': '{acres} acres. {contained}',
    'fire.contained': '{p} % contenido.',

    'off.title': 'Mapas sin conexión',
    'off.intro': 'Descarga el mapa antes de perder la señal. Cada descarga incluye senderos, inicios de sendero, relieve, curvas de nivel, límites de tierras y los reportes más recientes.',
    'off.downloadView': 'Descargar esta vista', 'off.name': 'Nombre', 'off.defaultName': 'Mapa cerca de {place}',
    'off.detail': 'Nivel de detalle', 'off.detail.standard': 'Estándar (zoom 14)', 'off.detail.high': 'Alto (zoom 15)',
    'off.includeBase': 'Guardar también el mapa base actual ({base})',
    'off.estimate': '{tiles} teselas, unos {size}', 'off.tooBig': 'Demasiado grande para una sola descarga. Acércate o baja el detalle.',
    'off.tooSmall': 'Aléjate un poco para cubrir más terreno.',
    'off.start': 'Descargar', 'off.cancel': 'Cancelar', 'off.delete': 'Eliminar', 'off.show': 'Mostrar',
    'off.ready': 'Listo sin conexión', 'off.partial': 'Descarga parcial. Descarga de nuevo para completarla.', 'off.downloading': 'Descargando {p} %',
    'off.cancelled': 'Cancelado',
    'off.none': 'Todavía no hay mapas descargados.', 'off.storage': 'Almacenamiento en este teléfono',
    'off.used': 'Datos de mapas: {cache}. Tus notas y ajustes: {data}. Libre: {free}.',
    'off.clearCache': 'Borrar caché de navegación', 'off.clearCacheNote': 'Los mapas descargados se conservan.',
    'off.export': 'Exportar', 'off.exportImage': 'Guardar imagen del mapa', 'off.exportGpx': 'Exportar senderos visibles (GPX)',
    'off.noTrails': 'Aún no hay senderos cargados en esta vista. Acércate e inténtalo de nuevo.',
    'off.saved': 'Guardado.', 'off.deleteConfirm': '¿Eliminar "{name}"? Los datos del mapa se borrarán de este teléfono.',

    'pl.title': 'Lugares y reportes de campo', 'pl.saveCenter': 'Marcar el centro del mapa', 'pl.saveHere': 'Marcar mi ubicación',
    'pl.none': 'Aún no hay nada guardado. Mantén presionado el mapa para poner un marcador.',
    'pl.note': 'Nota', 'pl.name': 'Nombre', 'pl.pin': 'Marcador', 'pl.report': 'Reporte de campo', 'pl.save': 'Guardar', 'pl.delete': 'Eliminar',
    'pl.show': 'Mostrar', 'pl.edit': 'Editar', 'common.needsApp': 'Esto requiere la app de Android.', 'pl.share': 'Compartir', 'pl.type': 'Tipo', 'pl.newPin': 'Nuevo marcador', 'pl.newReport': 'Nuevo reporte de campo',
    'pl.reportNote': 'Tus reportes se quedan en este teléfono (y en tus respaldos). No se suben a ningún lado.',
    'rep.conditions': 'Estado del sendero', 'rep.blowdown': 'Árboles caídos', 'rep.water': 'Fuente de agua', 'rep.snow': 'Nieve o hielo',
    'rep.closure': 'Cierre', 'rep.wildlife': 'Fauna', 'rep.other': 'Otro',

    'ft.trailhead': 'Inicio de sendero', 'ft.address': 'Dirección', 'ft.nearestAddress': 'Dirección vial más cercana',
    'ft.noAddress': 'No hay dirección vial aquí. Usa las coordenadas.', 'ft.lookingUp': 'Buscando la dirección más cercana…',
    'ft.coords': 'Coordenadas', 'ft.copy': 'Copiar', 'ft.copied': 'Copiado', 'ft.directions': 'Cómo llegar',
    'ft.conditions': 'Condiciones aquí', 'ft.pin': 'Marcar', 'ft.difficulty': 'Dificultad', 'ft.surface': 'Superficie',
    'ft.visibility': 'Visibilidad del sendero', 'ft.surveyed': 'Último relevamiento', 'ft.access': 'Acceso', 'ft.partOf': 'Forma parte de',
    'ft.elevation': 'Altitud', 'ft.manager': 'Administrado por', 'ft.publicAccess': 'Acceso público', 'ft.source': 'Fuente',
    'ft.unnamed': 'Sendero sin nombre', 'ft.climbs': '{n} vías', 'ft.grade': 'Grado', 'ft.length': 'Longitud del tramo',
    'ft.designation': 'Designación', 'ft.parking': 'Estacionamiento', 'ft.fee': 'Cuota', 'ft.yes': 'Sí', 'ft.no': 'No',
    'ft.oneway': 'Un solo sentido', 'ft.lit': 'Iluminado de noche', 'ft.width': 'Ancho',

    'kind.hiking': 'Sendero de excursionismo', 'kind.footway': 'Camino peatonal', 'kind.steps': 'Escaleras', 'kind.ski_downhill': 'Pista de esquí alpino',
    'kind.ski_nordic': 'Pista de esquí de fondo', 'kind.ski_other': 'Ruta de esquí', 'kind.atv': 'Sendero para cuatrimotos o todoterreno',
    'kind.bike': 'Sendero para bicicleta', 'kind.horse': 'Sendero ecuestre', 'kind.via_ferrata': 'Vía ferrata', 'kind.track': 'Camino de terracería o forestal',
    'kind.climb': 'Vía de escalada', 'kind.crag': 'Zona de escalada', 'kind.peak': 'Cumbre', 'kind.land': 'Tierra pública', 'kind.tribal': 'Tierra tribal o de las Primeras Naciones',
    'kind.place': 'Lugar', 'kind.pin': 'Marcador', 'kind.report': 'Reporte de campo',

    'piste.novice': 'Principiante', 'piste.easy': 'Fácil', 'piste.intermediate': 'Intermedia', 'piste.advanced': 'Avanzada',
    'piste.expert': 'Experta', 'piste.freeride': 'Fuera de pista', 'piste.extreme': 'Extrema',
    'sac.hiking': 'Senderismo fácil (T1)', 'sac.mountain_hiking': 'Senderismo de montaña (T2)', 'sac.demanding_mountain_hiking': 'Senderismo de montaña exigente (T3)',
    'sac.alpine_hiking': 'Senderismo alpino (T4)', 'sac.demanding_alpine_hiking': 'Senderismo alpino exigente (T5)', 'sac.difficult_alpine_hiking': 'Senderismo alpino difícil (T6)',
    'vis.excellent': 'Excelente', 'vis.good': 'Buena', 'vis.intermediate': 'Intermitente', 'vis.bad': 'Mala', 'vis.horrible': 'Muy mala', 'vis.no': 'Sin sendero visible',
    'access.open': 'Abierto', 'access.restricted': 'Restringido', 'access.closed': 'Cerrado', 'access.unknown': 'Desconocido',

    'set.title': 'Ajustes', 'set.language': 'Idioma', 'set.appearance': 'Apariencia',
    'appear.auto': 'Automática', 'appear.auto.d': 'Clara de día, oscura después de la puesta del sol en tu ubicación.',
    'appear.light': 'Clara', 'appear.dark': 'Oscura', 'appear.now': 'Modo actual: {mode}. Puesta del sol {sunset}, salida {sunrise}.',
    'set.units': 'Unidades', 'units.imperial': 'Pies y millas', 'units.metric': 'Metros y kilómetros',
    'set.keepAwake': 'Mantener la pantalla encendida con el mapa abierto',
    'set.npsKey': 'Clave de API del Servicio de Parques Nacionales (opcional)',
    'set.npsKeyNote': 'La clave de demostración compartida tiene límites bajos por hora. Una clave gratuita de developer.nps.gov los aumenta.',
    'set.strideReset': 'Restablecer el modelo de pasos',
    'set.backup': 'Respaldo',
    'backup.drive': 'Respaldar en Google Drive',
    'backup.driveNote': 'Abre el selector de archivos de Android. Elige Google Drive (o cualquier carpeta) como destino. Todo lo demás se queda en este teléfono.',
    'backup.includeMaps': 'Incluir mapas descargados (archivo más grande)',
    'backup.restore': 'Restaurar desde un respaldo', 'backup.done': 'Respaldo guardado ({n} archivos).', 'restore.done': 'Se restauraron {n} archivos. Recargando.',
    'file.failed': 'No funcionó: {e}', 'file.cancelled': 'Cancelado.',
    'about.title': 'Acerca de Bristlecone',
    'about.story': 'El pino bristlecone de la Gran Cuenca crece en terrenos altos y secos donde casi nada más prospera. Crece despacio, guarda un registro claro de cada año que vive y lleva miles de años haciéndolo. La app Bristlecone parte de la misma idea: constante, precisa y clara sobre lo que sabe. Cada línea del mapa viene de datos públicos y se redibuja para el sendero. Los reportes se ordenan del más reciente al más antiguo. Cuando la app está estimando tu posición, te lo dice.',
    'about.estimates': 'Cómo funcionan las estimaciones de posición',
    'about.estimatesBody': 'Con buena señal GPS, Bristlecone la usa directamente y aprende en silencio la longitud de tu zancada a distintos ritmos y pendientes. Si se pierde el GPS, intenta la ubicación por Wi-Fi y red celular; luego cuenta tus pasos y sigue el rumbo de la brújula desde el último punto confiable, usando esa zancada aprendida. El círculo ámbar crece a medida que la estimación envejece. Tómala como guía y confírmala con puntos de referencia.',
    'about.credits': 'Fuentes de datos y créditos', 'about.maker': 'Creado por H.M. Jackson.', 'about.version': 'Versión {v}',
    'about.privacy': 'Sin cuenta. Sin rastreo. Tu ubicación solo sale del teléfono como solicitudes de mapa a las fuentes públicas que aparecen aquí.',

    'note.1': 'Los pinos bristlecone pueden vivir más de 4,000 años en suelos delgados y rocosos.',
    'note.2': 'Descarga tu mapa antes de llegar al inicio del sendero. Bristlecone funciona sin señal.',
    'note.3': 'Los reportes se ordenan del más reciente al más antiguo, y los viejos se marcan como viejos.',
    'note.4': 'Cuando se pierde el GPS, Bristlecone estima tu posición y te lo dice.',
    'note.5': 'Las curvas de nivel se trazan en el teléfono con datos públicos de elevación, en tus unidades.',
    'note.6': 'Los inicios de sendero sin dirección muestran coordenadas que puedes copiar o compartir.',
    'note.label': 'Nota de campo',

    'common.close': 'Cerrar', 'common.cancel': 'Cancelar', 'common.save': 'Guardar', 'common.ok': 'Aceptar', 'common.loading': 'Cargando…',
    'toast.offline': 'Sin conexión. Usando los datos de mapa guardados en este teléfono.', 'toast.online': 'Conexión restablecida.',
    'toast.pinSaved': 'Marcador guardado.', 'toast.reportSaved': 'Reporte de campo guardado.', 'toast.downloadStarted': 'Descarga iniciada. Puedes seguir usando el mapa.',
    'toast.downloadDone': '"{name}" está listo sin conexión.', 'toast.locating': 'Buscando tu posición…',
    'export.watermark': 'Bristlecone · Conoce el terreno.',
    'unit.ft': 'pies', 'unit.mi': 'mi', 'unit.m': 'm', 'unit.km': 'km'
  };

  const LANGS = {
    'en-US': { label: 'English (US)', dict: en, units: 'imperial', date: 'en-US' },
    'en-CA': { label: 'English (Canada)', dict: enCA, units: 'metric', date: 'en-CA' },
    'fr-CA': { label: 'Français (Canada)', dict: fr, units: 'metric', date: 'fr-CA' },
    'es-419': { label: 'Español (EE. UU. y Latinoamérica)', dict: es, units: 'imperial', date: 'es-US' }
  };

  let current = 'en-US';

  function pickDefault(locale) {
    const l = (locale || navigator.language || 'en-US').replace('_', '-');
    const [lang, region] = l.split('-');
    if (lang === 'fr') return 'fr-CA';
    if (lang === 'es') return 'es-419';
    if (lang === 'en' && region === 'CA') return 'en-CA';
    return 'en-US';
  }

  function t(key, vars) {
    const d = LANGS[current].dict;
    let s = d[key];
    if (s === undefined) s = en[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  }

  function apply(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    (root || document).querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.documentElement.lang = current;
  }

  window.I18N = {
    LANGS, t, apply, pickDefault,
    get lang() { return current; },
    set lang(v) { if (LANGS[v]) current = v; },
    dateLocale() { return LANGS[current].date; },
    defaultUnits(l) { return (LANGS[l || current] || LANGS['en-US']).units; },
    _dicts: { en, enCA, fr, es }
  };
})();
