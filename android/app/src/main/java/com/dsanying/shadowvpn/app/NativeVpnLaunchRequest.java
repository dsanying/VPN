package com.dsanying.shadowvpn.app;

import org.json.JSONObject;

/** Unconfirmed launches remain separate from the successful recovery journal. */
final class NativeVpnLaunchRequest {
    private static final String DOCUMENT="native.vpn.pending";
    private final NativeStateStore store;
    NativeVpnLaunchRequest(NativeStateStore store){this.store=store;}
    synchronized String stage(String config,JSONObject nodes) throws Exception {
        if(config==null||config.trim().isEmpty()||config.length()>16*1024*1024)throw new IllegalArgumentException("无效启动配置");
        String token=java.util.UUID.randomUUID().toString();
        JSONObject record=new JSONObject().put("token",token).put("config",config).put("nodes",NativeVpnJournal.validateNodes(nodes));
        store.write(DOCUMENT,record.toString());
        return token;
    }
    synchronized JSONObject consume(String token) throws Exception {
        String content=store.read(DOCUMENT);
        if(content==null)throw new IllegalStateException("启动请求已失效");
        JSONObject record=new JSONObject(content);
        if(!java.util.Objects.equals(token,record.getString("token")))throw new IllegalStateException("启动请求不匹配");
        store.delete(DOCUMENT);
        if(record.getString("config").trim().isEmpty())throw new IllegalStateException("启动配置为空");
        record.put("nodes",NativeVpnJournal.validateNodes(record.getJSONObject("nodes")));
        return record;
    }
    synchronized void cancel(String token) throws Exception {
        String content=store.read(DOCUMENT);
        if(content!=null&&java.util.Objects.equals(token,new JSONObject(content).getString("token")))clear();
    }
    synchronized void clear(){store.delete(DOCUMENT);}
}
