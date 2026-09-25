package app.bristlecone;

import android.content.Context;

import org.json.JSONArray;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * On-phone storage for settings, saved places and field reports, plus backup and restore.
 * Backups are a single .zip written through Android's document picker, so the user can
 * send them straight to Google Drive (or anywhere else) with no account setup in the app.
 */
public final class Storage {
    private final File kvDir;
    private final File root;

    public Storage(Context ctx) {
        root = ctx.getFilesDir();
        kvDir = new File(root, "kv");
        //noinspection ResultOfMethodCallIgnored
        kvDir.mkdirs();
    }

    static String safe(String key) { return key.replaceAll("[^A-Za-z0-9_.-]", "_"); }

    public synchronized String get(String key) {
        File f = new File(kvDir, safe(key) + ".json");
        if (!f.exists()) return null;
        try { return new String(NetCache.readAll(new FileInputStream(f)), "UTF-8"); } catch (IOException e) { return null; }
    }

    public synchronized boolean put(String key, String value) {
        try {
            File tmp = new File(kvDir, safe(key) + ".json.tmp");
            FileOutputStream o = new FileOutputStream(tmp);
            o.write(value.getBytes("UTF-8"));
            o.getFD().sync();
            o.close();
            return tmp.renameTo(new File(kvDir, safe(key) + ".json"));
        } catch (IOException e) {
            return false;
        }
    }

    public synchronized void remove(String key) {
        //noinspection ResultOfMethodCallIgnored
        new File(kvDir, safe(key) + ".json").delete();
    }

    public synchronized JSONArray keys(String prefix) {
        JSONArray a = new JSONArray();
        File[] fs = kvDir.listFiles();
        if (fs != null) for (File f : fs) {
            String n = f.getName();
            if (!n.endsWith(".json")) continue;
            n = n.substring(0, n.length() - 5);
            if (prefix == null || n.startsWith(safe(prefix))) a.put(n);
        }
        return a;
    }

    public long kvBytes() {
        long t = 0;
        File[] fs = kvDir.listFiles();
        if (fs != null) for (File f : fs) t += f.length();
        return t;
    }

    // ------------------------------------------------------------------ Backup and restore

    /** Writes kv/ (and optionally regions/ and cache/) to a zip. Returns number of files. */
    public int backup(OutputStream out, boolean includeMaps) throws IOException {
        ZipOutputStream zo = new ZipOutputStream(out);
        int n = 0;
        try {
            ZipEntry marker = new ZipEntry("bristlecone-backup.txt");
            zo.putNextEntry(marker);
            zo.write(("Bristlecone backup\nformat=1\ncreated=" + System.currentTimeMillis() + "\nmaps=" + includeMaps + "\n").getBytes("UTF-8"));
            zo.closeEntry();
            n += addDir(zo, kvDir, "kv/");
            n += addDir(zo, new File(root, "tracks"), "tracks/");
            if (includeMaps) {
                n += addDir(zo, new File(root, "regions"), "regions/");
                n += addDir(zo, new File(root, "cache"), "cache/");
            }
        } finally {
            zo.finish();
            zo.flush();
            out.close();
        }
        return n;
    }

    private int addDir(ZipOutputStream zo, File dir, String prefix) throws IOException {
        File[] fs = dir.listFiles();
        if (fs == null) return 0;
        int n = 0;
        byte[] buf = new byte[32768];
        for (File f : fs) {
            if (!f.isFile() || f.getName().endsWith(".tmp")) continue;
            zo.putNextEntry(new ZipEntry(prefix + f.getName()));
            FileInputStream in = new FileInputStream(f);
            int r;
            while ((r = in.read(buf)) > 0) zo.write(buf, 0, r);
            in.close();
            zo.closeEntry();
            n++;
        }
        return n;
    }

    /** Restores a backup zip. Only known folders are written; anything else is ignored. */
    public int restore(InputStream in) throws IOException {
        ZipInputStream zi = new ZipInputStream(in);
        int n = 0;
        boolean valid = false;
        byte[] buf = new byte[32768];
        try {
            ZipEntry e;
            while ((e = zi.getNextEntry()) != null) {
                String name = e.getName();
                if (name.equals("bristlecone-backup.txt")) { valid = true; continue; }
                if (!valid) throw new IOException("not a Bristlecone backup");
                if (e.isDirectory() || name.contains("..")) continue;
                String folder;
                if (name.startsWith("kv/")) folder = "kv";
                else if (name.startsWith("tracks/")) folder = "tracks";
                else if (name.startsWith("regions/")) folder = "regions";
                else if (name.startsWith("cache/")) folder = "cache";
                else continue;
                String file = name.substring(folder.length() + 1);
                if (file.contains("/") || file.isEmpty()) continue;
                File dir = new File(root, folder);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                FileOutputStream o = new FileOutputStream(new File(dir, file));
                int r;
                while ((r = zi.read(buf)) > 0) o.write(buf, 0, r);
                o.close();
                n++;
            }
        } finally {
            zi.close();
        }
        if (!valid) throw new IOException("not a Bristlecone backup");
        return n;
    }
}
