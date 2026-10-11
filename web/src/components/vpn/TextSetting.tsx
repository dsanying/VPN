import { Input } from 'antd';
import { useState, useRef } from 'react';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
/** 草稿不写入权威配置；提交失败保留输入，离焦或回车才保存。 */
export function TextSetting({value,onCommit,multiline=false,label}:{value?:string;onCommit:(value:string)=>Promise<void>;multiline?:boolean;label:string}){
 const committing=useRef(false);
 const [draft,setDraft]=useState(value??'');const [saved,setSaved]=useState(value??'');const [busy,setBusy]=useState(false);
 if(saved!==(value??'')&&!busy){setSaved(value??'');setDraft(value??'');}
 const commit=async()=>{if(committing.current||draft===(value??''))return;committing.current=true;setBusy(true);try{await onCommit(draft);setSaved(draft);notifyActionSuccess('save',label);}catch(e){notifyActionFailed('save',e);}finally{committing.current=false;setBusy(false);}};
 return multiline?<Input.TextArea aria-label={label} allowClear value={draft} autoSize={{minRows:2,maxRows:6}} disabled={busy} onChange={e=>setDraft(e.target.value)} onBlur={()=>void commit()}/>:<Input aria-label={label} allowClear value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onBlur={()=>void commit()} onPressEnter={()=>void commit()}/>;
}
