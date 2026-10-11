package com.dsanying.shadowvpn.app;

import org.json.JSONObject;

/** Only a successfully established native tunnel becomes eligible for process/boot recovery. */
final class NativeVpnJournal {
    private static final String DOCUMENT = "native.vpn.resume";
    private final NativeStateStore store;
    NativeVpnJournal(NativeStateStore store) { this.store = store; }
    synchronized void committed(String config) throws Exception {
        committed(config, new JSONObject());
    }
    synchronized void committed(String config, JSONObject nodes) throws Exception {
        if (config == null || config.trim().isEmpty() || config.length() > 16 * 1024 * 1024)
            throw new IllegalArgumentException("无效恢复配置");
        JSONObject record = new JSONObject();
        record.put("schema", 2); record.put("config", config); record.put("nodes", validateNodes(nodes));
        store.write(DOCUMENT, record.toString());
    }
    synchronized String read() throws Exception {
        JSONObject record = readRecord();
        return record == null ? null : record.getString("config");
    }
    static JSONObject validateNodes(JSONObject nodes) throws Exception {
        if (nodes == null) return new JSONObject();
        if (nodes.length() > 10000) throw new IllegalArgumentException("节点记录过多");
        java.util.Iterator<String> keys = nodes.keys();
        while (keys.hasNext()) {
            String id = keys.next();
            if (id.isEmpty() || id.length() > 256 || !(nodes.get(id) instanceof String) || !nodes.getString(id).matches("[a-f0-9]{64}"))
                throw new IllegalArgumentException("无效应用节点记录");
        }
        return new JSONObject(nodes.toString());
    }
    synchronized JSONObject readRecord() throws Exception {
        String content = store.read(DOCUMENT);
        if (content == null) return null;
        try {
            JSONObject record = new JSONObject(content);
            int schema = record.getInt("schema");
            if (schema != 1 && schema != 2) throw new IllegalArgumentException();
            String config = record.getString("config");
            if (config.trim().isEmpty() || config.length() > 16 * 1024 * 1024) throw new IllegalArgumentException();
            if (schema == 2 && !(record.opt("nodes") instanceof JSONObject)) throw new IllegalArgumentException();
            record.put("nodes", validateNodes(record.optJSONObject("nodes")));
            return record;
        } catch (Exception malformed) {
            clear();
            throw new IllegalStateException("VPN 恢复配置无效，已清理");
        }
    }
    synchronized void clear() { store.delete(DOCUMENT); }
}
