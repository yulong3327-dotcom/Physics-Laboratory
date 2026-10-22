import {useEffect,useRef,useState} from 'react';
import {Package,Search,X,LoaderCircle} from 'lucide-react';
import {api} from '../shared/api';

const labels={pending:'待发货',shipped:'已发货',delivered:'已收货',cancelled:'已取消'};
const date=value=>value?new Date(value).toLocaleString('zh-CN'):'—';
const addressText=a=>a?`${a.province}${a.city}${a.district} ${a.detail}`:'—';

export default function ShippingManager(){
 const [shipments,setShipments]=useState([]),[config,setConfig]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [q,setQ]=useState(''),[status,setStatus]=useState(''),[selected,setSelected]=useState(null),[form,setForm]=useState({}),[saving,setSaving]=useState(false),[formError,setFormError]=useState('');
 const [tracking,setTracking]=useState(null),[trackingError,setTrackingError]=useState(''),[trackingLoading,setTrackingLoading]=useState(false);
 const active=useRef(true),loadId=useRef(0),trackingId=useRef(0);
 useEffect(()=>{active.current=true;load();return()=>{active.current=false;loadId.current++;trackingId.current++;};},[]);
 async function load(){const id=++loadId.current;setLoading(true);setError('');try{const [records,settings]=await Promise.all([api('/admin/shipments'),api('/admin/logistics/config')]);if(active.current&&id===loadId.current){setShipments(records);setConfig(settings);}}catch(e){if(active.current&&id===loadId.current)setError(e.message);}finally{if(active.current&&id===loadId.current)setLoading(false);}}
 function edit(record){trackingId.current++;setSelected(record);setForm({courierCode:record.courierCode||'',trackingNumber:record.trackingNumber||'',note:record.note||''});setFormError('');setTracking(null);setTrackingError('');setTrackingLoading(false);}
 function close(){if(saving)return;trackingId.current++;setSelected(null);setTracking(null);}
 async function save(nextStatus){
  if(saving||!selected)return;
  const courier=config?.supportedCarriers?.find(c=>c.code===form.courierCode);
  if(nextStatus==='shipped'&&(!courier||!/^[a-zA-Z0-9-]{6,32}$/.test(form.trackingNumber?.trim()||''))){setFormError('请选择快递公司，并填写 6 到 32 位字母、数字或减号的快递单号');return;}
  if(nextStatus==='shipped'&&selected.status==='pending'&&!window.confirm(`确认将“${selected.courseTitle}”标记为已发货？请确认包裹已经交给快递。`))return;
  if(nextStatus==='cancelled'&&!window.confirm('确认取消本次讲义寄送？课程购买权益不受影响。'))return;
  setSaving(true);setFormError('');
  try{const updated=await api(`/admin/shipments/${encodeURIComponent(selected.id)}`,{method:'PATCH',body:{status:nextStatus,courierCode:form.courierCode,courierName:courier?.name||selected.courierName||'',trackingNumber:form.trackingNumber.trim(),note:form.note}});if(!active.current)return;setShipments(rows=>rows.map(row=>row.id===updated.id?updated:row));setSelected(updated);setNotice('寄送信息已保存');setTracking(null);trackingId.current++;}
  catch(e){if(active.current)setFormError(e.message);}finally{if(active.current)setSaving(false);}
 }
 async function queryTracking(){const id=++trackingId.current;setTrackingLoading(true);setTrackingError('');setTracking(null);try{const result=await api(`/admin/shipments/${encodeURIComponent(selected.id)}/tracking`);if(active.current&&id===trackingId.current)setTracking(result);}catch(e){if(active.current&&id===trackingId.current)setTrackingError(e.message);}finally{if(active.current&&id===trackingId.current)setTrackingLoading(false);}}
 const filtered=shipments.filter(s=>(!status||s.status===status)&&`${s.userName} ${s.studentNumber} ${s.contactPhone} ${s.wechatId} ${s.orderId} ${s.courseTitle} ${s.trackingNumber} ${s.address.recipient}`.toLowerCase().includes(q.toLowerCase()));
 return <>
  {error&&<div className="adm-error" role="alert">{error}<button onClick={load}>重试</button></div>}
  {notice&&<div className="adm-shipping-notice" role="status">{notice}<button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  <section className="adm-panel">
   <div className="adm-panel-heading"><h2><Package size={19}/> 讲义寄送 <span>{shipments.length}</span></h2><button onClick={load} disabled={loading}>刷新数据</button></div>
   <div className={`adm-logistics-status ${config?.configured?'ready':''}`}>{config?.configured?'快递100物流查询已配置；物流信息最多每 30 分钟更新一次。':'物流查询尚未开通：可先保存发货单，开通快递100并配置授权后查看真实轨迹。'}</div>
   <div className="adm-shipping-filters"><label className="adm-search"><Search size={17}/><input aria-label="搜索寄送记录" placeholder="搜索学员、课程、收件人或单号" value={q} onChange={e=>setQ(e.target.value)}/></label><select aria-label="寄送状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
   {loading?<div className="adm-loading"><LoaderCircle className="adm-spin"/>正在加载寄送记录…</div>:<div className="adm-table-wrap"><table><thead><tr><th>课程 / 订单</th><th>学员 / 联系方式</th><th>收件信息</th><th>状态 / 物流</th><th>申请时间</th><th>操作</th></tr></thead><tbody>{filtered.map(s=><tr key={s.id}><td><b>{s.courseTitle}</b><small className="adm-order-id">{s.orderId}</small></td><td>{s.userName}<small title={s.studentNumber}>学员编号 {s.studentNumber}</small><small>微信号：{s.wechatId||'未填写'}</small><small>联系手机：{s.contactPhone||'未填写'}</small></td><td>{s.address.recipient} · {s.address.phone}<small className="adm-shipping-address">{addressText(s.address)}</small></td><td><span className={`adm-badge ${s.status==='shipped'?'paid':s.status}`}>{labels[s.status]}</span><small>{s.courierName||'尚未发货'}</small><small>{s.trackingNumber}</small></td><td>{date(s.createdAt)}</td><td><button className="adm-order-detail-link" onClick={()=>edit(s)}>{s.status==='pending'?'填写发货':'查看详情'}</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="adm-empty"><Package size={30}/><p>{shipments.length?'没有符合条件的寄送记录':'暂无寄送申请'}</p><small>在课程中开启“实物讲义寄送”后，已付款学员可在小程序中选择收货地址申请。</small></div>}</div>}
  </section>
  {selected&&<div className="adm-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="adm-modal adm-shipment-modal" role="dialog" aria-modal="true" aria-label="讲义寄送详情"><header><h2>讲义寄送详情</h2><button onClick={close} disabled={saving} aria-label="关闭寄送详情"><X size={20}/></button></header><dl className="adm-order-details"><div><dt>课程</dt><dd>{selected.courseTitle}</dd></div><div><dt>订单号</dt><dd>{selected.orderId}</dd></div><div><dt>寄送状态</dt><dd>{labels[selected.status]}</dd></div><div><dt>收件人</dt><dd>{selected.address.recipient} · {selected.address.phone}</dd></div><div><dt>收货地址</dt><dd>{addressText(selected.address)}</dd></div><div><dt>发货 / 收货</dt><dd>{date(selected.shippedAt)} / {date(selected.deliveredAt)}</dd></div></dl>
   <form className="adm-shipping-form" onSubmit={e=>{e.preventDefault();save(selected.status==='pending'?'shipped':selected.status);}}><fieldset disabled={saving||selected.status==='delivered'}><label>快递公司<select value={form.courierCode} onChange={e=>setForm({...form,courierCode:e.target.value})}><option value="">请选择快递公司</option>{config?.supportedCarriers?.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label><label>快递单号<input maxLength={32} value={form.trackingNumber} onChange={e=>setForm({...form,trackingNumber:e.target.value})} placeholder="填写实际运单号"/></label><label>寄送备注<textarea maxLength={1000} rows={3} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="学生可查看此备注，请勿填写内部凭据"/></label></fieldset>{formError&&<div className="adm-error" role="alert">{formError}</div>}<div className="adm-shipping-actions">{selected.status==='pending'&&<><button type="submit" className="adm-primary" disabled={saving}>确认发货</button><button type="button" className="adm-secondary" disabled={saving} onClick={()=>save('pending')}>保存备注</button><button type="button" className="adm-secondary" disabled={saving} onClick={()=>save('cancelled')}>取消寄送</button></>}{selected.status==='shipped'&&<button className="adm-primary" disabled={saving}>保存物流修改</button>}{selected.status==='cancelled'&&<button type="button" className="adm-secondary" disabled={saving} onClick={()=>save('pending')}>恢复待发货</button>}</div></form>
   {['shipped','delivered'].includes(selected.status)&&<section className="adm-tracking-panel"><button type="button" className="adm-secondary" disabled={trackingLoading||saving} onClick={queryTracking}>{trackingLoading?'正在查询…':'查询真实物流'}</button>{trackingError&&<p role="alert" className="adm-tracking-error">{trackingError}</p>}{tracking&&<><p>{tracking.message}</p><small>查询时间：{date(tracking.checkedAt)}</small><ol>{tracking.events.map((event,i)=><li key={i}><time>{event.time}</time><p>{event.context}</p></li>)}</ol>{!tracking.events.length&&<p>暂无物流轨迹</p>}</>}</section>}
  </section></div>}
 </>;
}
