import {InputNumber,type InputNumberProps} from 'antd';
import {useRef,useState} from 'react';
import {notifyActionFailed,notifyActionSuccess} from '@/utils/feedback';
/** 数值编辑完才保存，避免端口或间隔在逐字输入时反复应用中间值。 */
export function NumberSetting({value,onCommit,...props}:Omit<InputNumberProps<number>,'value'|'onChange'>&{value:number;onCommit:(value:number)=>Promise<void>}){
 const [draft,setDraft]=useState<number|null>(value);const [saved,setSaved]=useState(value);const [busy,setBusy]=useState(false);const committing=useRef(false);
 if(saved!==value&&!busy){setSaved(value);setDraft(value);}
 const commit=async()=>{
  if(committing.current||draft===value)return;
  if(draft===null||!Number.isInteger(draft)||draft<Number(props.min??-Infinity)||draft>Number(props.max??Infinity)){setDraft(value);return;}
  committing.current=true;setBusy(true);try{await onCommit(draft);setSaved(draft);notifyActionSuccess('save',props['aria-label']);}catch(e){notifyActionFailed('save',e);}finally{committing.current=false;setBusy(false);}
 };
 return <InputNumber {...props} precision={0} value={draft} disabled={busy||props.disabled} onChange={setDraft} onBlur={()=>void commit()} onPressEnter={()=>void commit()}/>;
}
