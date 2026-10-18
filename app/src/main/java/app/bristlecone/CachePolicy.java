package app.bristlecone;

import java.security.MessageDigest;

/**
 * Decides how each remote request is cached. Pure Java for off-device testing.
 *
 *  TILE : map tiles, glyphs, TileJSON. Served from disk if younger than 30 days.
 *  DATA : trail geometry, land boundaries, geocoding. Served from disk if younger than 7 days.
 *  FORECAST : forecast grids and station readings for mountain weather estimates. Reused for
 *         30 minutes (they update hourly at most), then refetched; offline, the last copy is used.
 *  LIVE : trail reports, weather alerts, avalanche forecasts. Always fetched fresh when online;
 *         the last copy is used only when offline, and the UI labels it with its age.
 */
public final class CachePolicy {
    public enum Kind { TILE, DATA, FORECAST, LIVE }

    public static final long DAY = 24L * 3600L * 1000L;

    private CachePolicy() {}

    public static Kind classify(String url) {
        String u = url.toLowerCase();
        String host = host(u);
        // Weather grid lookups and station lists change rarely; forecasts and readings hourly.
        if (host.equals("api.weather.gov") && (u.contains("/points/") || u.endsWith("/stations") || u.contains("/stations?"))) return Kind.DATA;
        if (host.equals("api.weather.gov") && (u.contains("/gridpoints/") || u.contains("/observations"))
                || host.equals("geo.weather.gc.ca") || u.contains("/collections/swob-realtime/")
                || host.equals("wcc.sc.egov.usda.gov") && u.contains("/data?")) return Kind.FORECAST;
        if (host.equals("wcc.sc.egov.usda.gov")) return Kind.DATA;
        if (host.equals("api.weather.gov") || host.equals("api.weather.gc.ca")
                || host.equals("developer.nps.gov") && u.contains("/alerts")
                || host.equals("api.avalanche.org") || host.equals("api.avalanche.ca")
                || host.equals("api.openstreetmap.org") || u.contains("wfigs")
                || u.contains("/api/v1/timelines/tag/")) {
            return Kind.LIVE;
        }
        if (host.equals("tiles.openfreemap.org") || host.contains("elevation-tiles-prod")
                || u.contains("/elevation-tiles-prod/") || host.equals("basemap.nationalmap.gov")
                || host.endsWith("tile.opentopomap.org") || u.contains("/mapserver/tile/")
                || u.contains("/fonts/") || u.endsWith(".pbf") || u.endsWith(".mvt")
                || u.endsWith(".png") || u.endsWith(".jpg") || u.endsWith(".jpeg") || u.endsWith(".webp")) {
            return Kind.TILE;
        }
        return Kind.DATA;
    }

    public static long ttl(Kind k) {
        switch (k) {
            case TILE: return 30 * DAY;
            case DATA: return 7 * DAY;
            case FORECAST: return 30L * 60L * 1000L;
            default: return 0;
        }
    }

    /**
     * OpenFreeMap publishes versioned tile paths (for example /planet/20260915_001001_pt/12/..).
     * The version segment is dropped from the cache key so a downloaded region keeps working
     * offline after the server rolls to a newer build.
     */
    public static String cacheKeyUrl(String url) {
        return url.replaceFirst("(tiles\\.openfreemap\\.org/[a-z]+)/\\d{8}_\\d{6}_pt/", "$1/_/");
    }

    public static String key(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(cacheKeyUrl(url).getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(url.hashCode());
        }
    }

    static String host(String u) {
        int s = u.indexOf("://");
        if (s < 0) return "";
        int e = u.indexOf('/', s + 3);
        String h = e < 0 ? u.substring(s + 3) : u.substring(s + 3, e);
        int c = h.indexOf(':');
        return c < 0 ? h : h.substring(0, c);
    }
}
