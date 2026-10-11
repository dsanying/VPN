package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import android.util.LruCache;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.util.*;

/** Local package identity and icon cache, invalidated by package updates and removal. */
final class NativeApplicationCatalog {
    private static final class Entry {
        final long revision;
        final String name, icon;
        Entry(long revision, String name, String icon) { this.revision = revision; this.name = name; this.icon = icon; }
    }
    private final PackageManager packages;
    private final LruCache<String, Entry> cache = new LruCache<>(128);
    NativeApplicationCatalog(Context context) { packages = context.getPackageManager(); }
    synchronized JSObject resolve(String packageName) throws PackageManager.NameNotFoundException {
        PackageInfo info = packages.getPackageInfo(packageName, 0);
        Entry entry = cache.get(packageName);
        if (entry == null || entry.revision != info.lastUpdateTime) {
            ApplicationInfo app = packages.getApplicationInfo(packageName, 0);
            String label = String.valueOf(packages.getApplicationLabel(app)).trim();
            if (label.isEmpty()) label = packageName;
            String icon = null;
            try {
                Drawable drawable = packages.getApplicationIcon(app);
                Bitmap bitmap = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888);
                try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    drawable.setBounds(0, 0, 48, 48); drawable.draw(new Canvas(bitmap));
                    if (bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
                        icon = "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
                } catch (java.io.IOException ignored) { /* Preserve name and routing identity without an icon. */ }
                finally { bitmap.recycle(); }
            } catch (RuntimeException ignored) { /* An inaccessible icon does not erase package identity. */ }
            entry = new Entry(info.lastUpdateTime, label, icon); cache.put(packageName, entry);
        }
        JSObject result = new JSObject(); result.put("id", packageName); result.put("name", entry.name);
        result.put("packageName", packageName); result.put("path", "android-package:" + packageName);
        result.put("processPaths", new JSArray().put("android-package:" + packageName));
        result.put("processPathRegex", new JSArray()); result.put("coverage", "package");
        if (entry.icon != null) result.put("iconDataUrl", entry.icon);
        return result;
    }
    synchronized JSArray list() {
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        Set<String> names = new TreeSet<>();
        for (ResolveInfo app : packages.queryIntentActivities(launcher, 0))
            if (app.activityInfo != null) names.add(app.activityInfo.packageName);
        JSArray result = new JSArray();
        for (String name : names) {
            try { result.put(resolve(name)); }
            catch (PackageManager.NameNotFoundException removed) { cache.remove(name); }
        }
        for (String name : new ArrayList<>(cache.snapshot().keySet()))
            if (!names.contains(name)) cache.remove(name);
        return result;
    }
}
