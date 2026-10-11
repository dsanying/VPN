package com.dsanying.shadowvpn.app;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Private durable documents, transactionally replaced; no external storage or WebView localStorage. */
final class NativeStateStore extends SQLiteOpenHelper {
    NativeStateStore(Context context) { super(context, "shadowvpn.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE documents (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)"); }
    @Override public void onUpgrade(SQLiteDatabase db, int previous, int next) { throw new IllegalStateException("未知数据库迁移"); }
    static void publicDocument(String name) {
        if (!java.util.Arrays.asList("config", "node-measurements", "subscription-measurements", "website-measurements", "ip-info", "release-checks", "release-catalog-trust", "maintenance-cycle", "logs").contains(name)) throw new IllegalArgumentException("不允许访问内部状态记录");
    }
    private void checkName(String name) {
        if (name == null || !name.matches("[a-zA-Z][a-zA-Z0-9._-]{0,63}")) throw new IllegalArgumentException("无效状态名称");
    }
    synchronized String read(String name) {
        checkName(name);
        SQLiteDatabase db=getReadableDatabase();
        boolean ownsTransaction=!db.inTransaction();
        if(ownsTransaction)db.beginTransactionNonExclusive();
        try {
            // CursorWindow has a platform size limit independent of our document size limit.
            // Keep each row bounded and all chunks in the same database snapshot.
            final int chunkSize=256*1024;
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
            int length;
            try(Cursor cursor=db.rawQuery("SELECT length(CAST(content AS BLOB)), substr(CAST(content AS BLOB),1,?) FROM documents WHERE name=?",new String[]{Integer.toString(chunkSize),name})){
                if(!cursor.moveToFirst())return null;
                length=cursor.getInt(0);
                if(length<0||length>64*1024*1024)throw new IllegalStateException("状态内容超过大小限制");
                byte[] first=cursor.getBlob(1);output.write(first,0,first.length);
            }
            while(output.size()<length){
                try(Cursor cursor=db.rawQuery("SELECT substr(CAST(content AS BLOB),?,?) FROM documents WHERE name=?",new String[]{Integer.toString(output.size()+1),Integer.toString(chunkSize),name})){
                    if(!cursor.moveToFirst())throw new IllegalStateException("状态读取不完整");
                    byte[] chunk=cursor.getBlob(0);
                    if(chunk.length==0)throw new IllegalStateException("状态读取不完整");
                    output.write(chunk,0,chunk.length);
                }
            }
            if(ownsTransaction)db.setTransactionSuccessful();
            return new String(output.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);
        }finally{if(ownsTransaction)db.endTransaction();}
    }
    static String revision(String content) {
        if (content == null) return null;
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder text = new StringBuilder(); for (byte value : digest) text.append(String.format(java.util.Locale.ROOT, "%02x", value & 255)); return text.toString();
        } catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    static final class Conflict extends IllegalStateException { Conflict() { super("配置已被其他任务更新，请重新读取后保存"); } }
    synchronized void write(String name, String content) { writeDocument(name, content, false, null); }
    synchronized String compareAndWrite(String name, String content, String expectedRevision) {
        writeDocument(name, content, true, expectedRevision); return revision(content);
    }
    private void writeDocument(String name, String content, boolean compare, String expectedRevision) {
        checkName(name);
        if (content == null || content.length() > 16 * 1024 * 1024) throw new IllegalArgumentException("状态内容为空或过大");
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            // Comparison and replacement share the SQLite transaction across all helper instances.
            if (compare && !java.util.Objects.equals(expectedRevision, revision(read(name)))) throw new Conflict();
            ContentValues row = new ContentValues(); row.put("name", name); row.put("content", content); row.put("updated_at", System.currentTimeMillis());
            if (db.insertWithOnConflict("documents", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0)
                throw new android.database.sqlite.SQLiteException("状态保存失败");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    synchronized void delete(String name) { checkName(name); getWritableDatabase().delete("documents", "name=?", new String[]{name}); }
}
