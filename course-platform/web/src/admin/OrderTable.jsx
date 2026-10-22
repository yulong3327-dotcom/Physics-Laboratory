import {useMemo,useState} from 'react';
import {AlertTriangle,ArrowDownToLine,BookOpen,Receipt,X} from 'lucide-react';

const money=n=>Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=d=>d?new Date(d).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const label=s=>({paid:'已支付',pending:'待支付',closed:'已关闭',cancelled:'已取消',refunded:'已退款',failed:'支付失败'}[s]||s||'—');
const channel=s=>({wechat:'微信支付',jsapi:'微信支付',native:'微信扫码',virtual:'微信虚拟支付',wechat_virtual:'微信虚拟支付','wechat-virtual':'微信虚拟支付',demo:'演示支付',free:'免费选课'}[s]||s||'—');
const paymentsOf=order=>Array.isArray(order.virtualPayments)?order.virtualPayments:[];
const duplicateCount=order=>Number(order.duplicatePaymentCount)||0;
function csv(value){const text=String(value??'');return `"${(/^[\s]*[=+\-@]/.test(text)?"'"+text:text).replace(/"/g,'""')}"`}

function PaymentReview({order}){
 if(!order.paymentReviewRequired&&!duplicateCount(order))return null;
 return <div className={`adm-payment-review ${order.paymentReviewRequired?'needs-review':''}`} role={order.paymentReviewRequired?'alert':'status'}><AlertTriangle size={19}/><div><b>{order.paymentReviewRequired?'重复付款待处理':'存在重复付款记录'}</b><p>{order.paymentReviewRequired?'同一订单有多笔仍为已支付的交易，请核对下方每笔交易，并在微信支付管理平台处理售后。':'请以每笔交易的支付、退款状态核对处理结果。'}累计记录 {duplicateCount(order)} 笔重复付款，课程权益按有效付款记录计算。</p></div></div>;
}

function VirtualPayments({order}){
 const payments=paymentsOf(order);
 if(!payments.length)return null;
 return <section className="adm-virtual-payments" aria-label="微信虚拟支付交易明细"><div className="adm-payment-heading"><h3>虚拟支付交易明细</h3><span>{payments.length} 笔支付尝试</span></div><p className="adm-payment-help">每次拉起支付独立记录。支付成功、退款及发货状态由服务端向微信核对。</p><div className="adm-payment-list">{payments.map(payment=><article className={payment.duplicatePayment?'duplicate':''} key={payment.id}><div className="adm-payment-title"><span className={`adm-badge ${payment.status}`}>{label(payment.status)}</span><strong>¥ {money(payment.amount)}</strong>{payment.duplicatePayment&&<span className={`adm-badge ${order.paymentReviewRequired&&payment.status==='paid'?'review':'duplicate'}`}>{order.paymentReviewRequired&&payment.status==='paid'?'重复付款 · 待核查':'重复付款记录'}</span>}</div><dl className="adm-order-details"><div><dt>支付单号</dt><dd>{payment.id}</dd></div><div><dt>微信交易号</dt><dd>{payment.transactionId||'—'}</dd></div><div><dt>发起时间</dt><dd>{date(payment.createdAt)}</dd></div><div><dt>支付时间</dt><dd>{date(payment.paidAt)}</dd></div><div><dt>退款时间</dt><dd>{date(payment.refundedAt)}</dd></div><div><dt>发货确认</dt><dd>{payment.deliveredAt?date(payment.deliveredAt):payment.status==='paid'?'待微信确认 / 系统重试中':'—'}</dd></div>{payment.error&&<div className="adm-payment-error"><dt>最近核对提示</dt><dd>{payment.error}</dd></div>}</dl></article>)}</div></section>;
}

export default function OrderTable({orders}){
 const [status,setStatus]=useState(''),[courseId,setCourseId]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[reviewOnly,setReviewOnly]=useState(false),[selectedId,setSelectedId]=useState(null);
 const courses=useMemo(()=>[...new Map(orders.map(o=>[o.courseId,o.courseTitle])).entries()],[orders]);
 const selected=orders.find(order=>order.id===selectedId);
 const filtered=orders.filter(order=>{
  const created=new Date(order.createdAt).getTime();
  return (!status||order.status===status)&&(!courseId||order.courseId===courseId)&&(!reviewOnly||order.paymentReviewRequired)&&(!from||created>=new Date(`${from}T00:00:00`).getTime())&&(!to||created<=new Date(`${to}T23:59:59.999`).getTime());
 });
 const paidTotal=filtered.filter(o=>o.status==='paid').reduce((sum,o)=>sum+Number(o.amount||0),0);
 const reviewCount=orders.filter(o=>o.paymentReviewRequired).length;
 function exportOrders(){const rows=[['订单号','课程','学员','手机号','金额(元)','状态','支付渠道','创建时间','支付时间','支付交易号','重复付款笔数','重复付款待处理','虚拟支付交易号明细'],...filtered.map(o=>[o.id,o.courseTitle,o.userName,o.phone,money(o.amount),label(o.status),channel(o.paymentChannel||o.payChannel),date(o.createdAt),date(o.paidAt),o.transactionId||'',duplicateCount(o),o.paymentReviewRequired?'是':'否',paymentsOf(o).map(p=>p.transactionId).filter(Boolean).join(' / ')])];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`课程订单-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <>
  {reviewCount>0&&<div className="adm-payment-review adm-payment-table-alert needs-review" role="alert"><AlertTriangle size={18}/><div><b>{reviewCount} 笔订单存在重复付款待处理</b><p>打开订单详情核对每笔交易；下方金额按课程订单统计，额外付款见交易明细。</p></div><button type="button" onClick={()=>{setStatus('');setCourseId('');setFrom('');setTo('');setReviewOnly(true)}}>查看待处理</button></div>}
  <div className="adm-order-filters"><label>订单状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{[...new Set(['paid','pending',...orders.map(o=>o.status)])].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label><label>课程<select value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">全部课程</option>{courses.map(([id,title])=><option key={id} value={id}>{title}</option>)}</select></label><label>开始日期<input type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><label>结束日期<input type="date" min={from||undefined} value={to} onChange={e=>setTo(e.target.value)}/></label><label className="adm-review-filter"><input type="checkbox" checked={reviewOnly} onChange={e=>setReviewOnly(e.target.checked)}/>仅重复付款待处理</label><button type="button" className="adm-secondary" disabled={!filtered.length} onClick={exportOrders}><ArrowDownToLine size={15}/>导出当前结果</button></div>
  <div className="adm-order-summary">筛选到 <b>{filtered.length}</b> 笔订单 <span>已支付订单金额 <strong>¥ {money(paidTotal)}</strong></span></div>
  <div className="adm-table-wrap"><table><thead><tr><th>课程 / 订单号</th><th>学员</th><th>金额</th><th>状态 / 支付渠道</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{filtered.map(order=><tr key={order.id}><td><b>{order.courseTitle}</b><small className="adm-order-id">{order.id}</small></td><td>{order.userName||'微信学员'}<small>{order.phone||'未绑定手机号'}</small></td><td><b>¥{money(order.amount)}</b></td><td><div className="adm-order-status"><span className={`adm-badge ${order.status}`}>{label(order.status)}</span>{order.paymentReviewRequired?<span className="adm-badge review">重复付款待处理</span>:duplicateCount(order)>0&&<span className="adm-badge duplicate">重复付款记录 {duplicateCount(order)} 笔</span>}</div><small>{channel(order.paymentChannel||order.payChannel)}</small></td><td>{date(order.createdAt)}</td><td><button className="adm-order-detail-link" onClick={()=>setSelectedId(order.id)}>查看详情</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="adm-empty"><BookOpen size={30}/><p>{orders.length?'没有符合条件的订单':'暂无订单，学员选课后将在这里显示'}</p></div>}</div>
  {selected&&<div className="adm-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedId(null)}}><section className="adm-modal adm-order-modal" role="dialog" aria-modal="true" aria-label="订单详情"><header><h2><Receipt size={22}/> 订单详情</h2><button aria-label="关闭订单详情" onClick={()=>setSelectedId(null)}><X size={21}/></button></header><PaymentReview order={selected}/><dl className="adm-order-details">{[['订单号',selected.id],['课程',selected.courseTitle],['学员',selected.userName||'微信学员'],['手机号',selected.phone||'未绑定'],['订单金额',`¥ ${money(selected.amount)}`],['订单状态',label(selected.status)],['支付渠道',channel(selected.paymentChannel||selected.payChannel)],['创建时间',date(selected.createdAt)],['支付时间',date(selected.paidAt)],['支付交易号',selected.transactionId||selected.wechatTransactionId||'—'],['重复付款笔数',duplicateCount(selected)],['付款核查',selected.paymentReviewRequired?'重复付款待处理':'无多笔有效付款待处理']].map(([title,value])=><div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl><VirtualPayments order={selected}/><div className="adm-order-readonly">支付成功和课程开通由服务端确认。退款请在微信支付管理平台处理，并等待服务端同步结果。</div></section></div>}
 </>;
}
