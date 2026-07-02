import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const APP_NAME = "下單系統";

// ─── 奶油白+玫瑰棕 韓式簡約色盤 ─────────────────────────────────
const C = {
  bg:          "#faf7f4",
  bgCard:      "#ffffff",
  bgDeep:      "#f3ede8",
  bgDark:      "#2c1f17",
  surface:     "#ffffff",
  border:      "#ecddd5",
  borderLight: "#f5ede7",
  text:        "#2c1f17",
  textMid:     "#5c4033",
  muted:       "#9e8478",
  faint:       "#c9b5ac",
  accent:      "#a0614a",
  accentLight: "#c4896e",
  accentBg:    "#fdf0ea",
  accentDark:  "#7a4535",
  green:       "#5a7a5a",
  greenBg:     "#eef5ee",
  amber:       "#8a6d3b",
  amberBg:     "#fdf5e8",
  red:         "#8a3a3a",
  redBg:       "#fdf0f0",
  blue:        "#3a5470",
  blueBg:      "#eef3f8",
  purple:      "#5a4870",
  purpleBg:    "#f0eef8",
  rose:        "#a05060",
  roseBg:      "#fdf0f3",
  shadow:      "0 2px 16px rgba(44,31,23,0.06)",
  shadowMd:    "0 6px 32px rgba(44,31,23,0.10)",
  shadowLg:    "0 12px 48px rgba(44,31,23,0.14)",
  r:           "20px",
  rSm:         "12px",
};

const ORDER_STATUS = {
  pending_review: { label:"審核中",  color:C.blue,   bg:C.blueBg   },
  pending:        { label:"待採購",  color:C.amber,  bg:C.amberBg  },
  bought:         { label:"已採購",  color:C.green,  bg:C.greenBg  },
  shipped:        { label:"已寄出",  color:C.purple, bg:C.purpleBg },
  arrived:        { label:"已到台",  color:C.accent, bg:C.accentBg },
  cancelled:      { label:"已取消",  color:C.red,    bg:C.redBg    },
};

const secureUid = () => { const a=new Uint8Array(9); crypto.getRandomValues(a); return Array.from(a,b=>b.toString(36).padStart(2,"0")).join("").slice(0,12); };
const sanitize = (s,max=200) => String(s??"").replace(/<[^>]*>/g,"").replace(/[<>"'`\\]/g,"").replace(/javascript:/gi,"").trim().slice(0,max);
const safeQty = n => { const v=parseInt(n,10); return Number.isFinite(v)&&v>=1&&v<=99?v:1; };
const safePrice = n => { const v=Number(n); return Number.isFinite(v)&&v>=0?Math.round(v*100)/100:0; };
const secureOrderNo = () => { const a=new Uint32Array(1); crypto.getRandomValues(a); return String(100000+(a[0]%900000)); };
const fmtMoney = n => `NT$ ${Number(n||0).toLocaleString()}`;
const formatShortDate = d => {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")}`;
  } catch { return d; }
};

// 解析品項名稱：拆出商品名稱和規格/款式
const parseItemName = (name) => {
  if (!name) return { mainName: "", variants: [] };
  const parts = name.split(" / ");
  const mainName = parts[0] || "";
  const variants = parts.slice(1).map(p => {
    const idx = p.indexOf("：");
    if (idx > -1) return { label: p.slice(0, idx), value: p.slice(idx + 1) };
    return { label: "", value: p };
  });
  return { mainName, variants };
};

const INIT_DATA = {
  rate:1,
  products:[
    {id:"p1",name:"高島屋土產代購",price:0,image:"🏯",status:"on",category:"土產"},
    {id:"p2",name:"無印良品代購",price:0,image:"🛍",status:"on",category:"生活"},
    {id:"p3",name:"藥妝代購",price:0,image:"💊",status:"on",category:"藥妝"},
    {id:"p4",name:"7-11代購",price:0,image:"🏪",status:"on",category:"便利商店"},
    {id:"p5",name:"吉伊卡哇扭蛋",price:0,image:"🎪",status:"on",category:"玩具"},
  ],
  inStock:[
    {id:"s1",name:"Hello Kitty 扭蛋 草莓款",price:350,image:"🎀",status:"on"},
    {id:"s2",name:"Sanrio 扭蛋 新款",price:280,image:"⭐",status:"on"},
  ],
  orders:[],wishlist:[],announcements:[],
};

// ─── 全域樣式注入 ─────────────────────────────────────────────────
const injectStyles = () => {
  if(document.getElementById("kr-styles"))return;
  const s=document.createElement("style");
  s.id="kr-styles";
  s.textContent=`
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:${C.bg};color:${C.text};font-family:'Noto Sans TC',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${C.faint};border-radius:99px}
    input,select,textarea,button{font-family:'Noto Sans TC',sans-serif;outline:none}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    @keyframes shimmer{from{opacity:.5}to{opacity:1}}
    .fadeUp{animation:fadeUp .35s cubic-bezier(.16,1,.3,1) both}
    input[type=number]{-moz-appearance:textfield}
    input::-webkit-inner-spin-button,input::-webkit-outer-spin-button{-webkit-appearance:none}
    .nav-btn{padding:9px 18px;border-radius:99px;border:1.5px solid ${C.border};background:transparent;color:${C.muted};font-size:13px;cursor:pointer;transition:all .2s;white-space:nowrap;font-weight:400;letter-spacing:.3px}
    .nav-btn.on{background:${C.accentBg};color:${C.accent};border-color:${C.accent}50;font-weight:500}
    .nav-btn.danger{color:${C.red};border-color:${C.red}40;background:${C.redBg}}
  `;
  document.head.appendChild(s);
};

// ─── UI 元件 ──────────────────────────────────────────────────────
const Card = ({children,style:sx,className})=>(
  <div className={className} style={{background:C.bgCard,borderRadius:C.r,boxShadow:C.shadow,border:`1px solid ${C.borderLight}`,...sx}}>
    {children}
  </div>
);

const Btn = ({children,onClick,variant="accent",sm,full,style:sx,disabled})=>{
  const v={
    accent:{background:C.accent,color:"#fff",border:"none"},
    outline:{background:"transparent",color:C.textMid,border:`1.5px solid ${C.border}`},
    ghost:{background:"transparent",color:C.muted,border:"none"},
    rose:{background:C.roseBg,color:C.rose,border:`1px solid ${C.rose}30`},
  };
  return(
    <button onClick={onClick} disabled={disabled} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,padding:sm?"7px 16px":"12px 24px",fontSize:sm?12:14,fontWeight:500,borderRadius:99,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.4:1,transition:"all .2s",width:full?"100%":undefined,...v[variant],...sx}}
      onMouseEnter={e=>{if(!disabled)e.currentTarget.style.opacity=".75";}}
      onMouseLeave={e=>{e.currentTarget.style.opacity=disabled?".4":"1";}}
    >{children}</button>
  );
};

const Field = ({label,value,onChange,type="text",placeholder,readOnly,style:sx})=>(
  <div style={{display:"flex",flexDirection:"column",gap:5,...sx}}>
    {label&&<label style={{fontSize:11,color:C.muted,fontWeight:500,letterSpacing:.5}}>{label}</label>}
    <input type={type} value={value??""} onChange={e=>onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly}
      style={{background:readOnly?C.bgDeep:C.surface,border:`1.5px solid ${C.border}`,borderRadius:C.rSm,padding:"11px 14px",color:readOnly?C.muted:C.text,fontSize:14,transition:"all .15s"}}
      onFocus={e=>{if(!readOnly){e.target.style.borderColor=C.accent;e.target.style.boxShadow=`0 0 0 3px ${C.accent}15`;}}}
      onBlur={e=>{e.target.style.borderColor=C.border;e.target.style.boxShadow="none";}}
    />
  </div>
);

const StatusPill = ({status})=>{
  const s=ORDER_STATUS[status]||ORDER_STATUS.pending;
  return <span style={{fontSize:11,color:s.color,background:s.bg,padding:"4px 12px",borderRadius:99,fontWeight:500,whiteSpace:"nowrap",letterSpacing:.3}}>{s.label}</span>;
};

const HR = ({style:sx})=><div style={{height:1,background:C.borderLight,...sx}}/>;

const Toast = ({msg,onDone})=>{
  useState(()=>{const t=setTimeout(onDone,2400);return()=>clearTimeout(t);});
  return <div style={{position:"fixed",bottom:36,left:"50%",transform:"translateX(-50%)",background:C.bgDark,color:"#fdf7f4",padding:"12px 28px",borderRadius:99,fontSize:13,fontWeight:500,boxShadow:C.shadowMd,zIndex:2000,whiteSpace:"nowrap",animation:"fadeUp .2s ease",letterSpacing:.3}}>{msg}</div>;
};

const Sheet = ({open,onClose,title,children})=>{
  if(!open)return null;
  return(
    <div style={{position:"fixed",inset:0,zIndex:500}}>
      <div style={{position:"absolute",inset:0,background:"rgba(44,31,23,.4)",backdropFilter:"blur(6px)"}} onClick={onClose}/>
      <div className="fadeUp" style={{position:"absolute",bottom:0,left:0,right:0,background:C.surface,maxHeight:"92vh",overflow:"auto",borderRadius:"28px 28px 0 0",boxShadow:C.shadowLg}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"22px 22px 18px",borderBottom:`1px solid ${C.borderLight}`}}>
          <span style={{fontSize:16,fontWeight:600,color:C.text,letterSpacing:.3}}>{title}</span>
          <button onClick={onClose} style={{background:C.bgDeep,border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:18,color:C.muted,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        <div style={{padding:"22px 22px 56px"}}>{children}</div>
      </div>
    </div>
  );
};

// ─── 導覽列（底部 Tab） ────────────────────────────────────────────
// SVG 圖示元件
const Icon = ({name,size=22,color})=>{
  const icons = {
    catalog: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.658-.463 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>,
    wishlist: <><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></>,
    orders: <><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"/></>,
    shipments: <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>,
    profile: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>,
  };
  return(
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="none" viewBox="0 0 24 24" stroke={color||"currentColor"} strokeWidth={1.5}>
      {icons[name]}
    </svg>
  );
};

function BottomNav({tab,setTab,cartCount}){
  const ITEMS=[
    {id:"catalog",label:"商品"},
    {id:"wishlist",label:"許願"},
    {id:"orders",label:"訂單"},
    {id:"shipments",label:"出貨"},
    {id:"profile",label:"我的"},
  ];
  return(
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.surface,borderTop:`1px solid ${C.borderLight}`,display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom,0)"}}>
      {ITEMS.map(it=>{
        const active=tab===it.id;
        return(
          <button key={it.id} onClick={()=>setTab(it.id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",gap:3,position:"relative"}}>
            <div style={{position:"relative"}}>
              <Icon name={it.id} size={22} color={active?C.accent:C.faint}/>
              {it.id==="catalog"&&cartCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:C.accent,color:"#fff",fontSize:8,width:14,height:14,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{cartCount}</span>}
            </div>
            <span style={{fontSize:10,color:active?C.accent:C.faint,fontWeight:active?600:400,letterSpacing:.3,transition:"color .15s"}}>{it.label}</span>
            {active&&<div style={{position:"absolute",bottom:0,width:20,height:2,background:C.accent,borderRadius:99}}/>}
          </button>
        );
      })}
    </div>
  );
}

// ─── LINE 登入 ────────────────────────────────────────────────────
function LineLogin({onSuccess}){
  const [status,setStatus]=useState("loading");
  const [err,setErr]=useState("");
  const [debug,setDebug]=useState({});

  useEffect(()=>{
    const liffId=import.meta.env.VITE_LIFF_ID;
    const sdkLoaded=typeof liff!=="undefined";
    setDebug({liffId:liffId||"(未設定)",sdkLoaded,ua:navigator.userAgent.slice(0,80)});

    if(!liffId){setStatus("error");setErr("⚠️ 未設定 VITE_LIFF_ID 環境變數\n請在 Vercel 後台 → Settings → Environment Variables 加入 VITE_LIFF_ID,並重新部署。");return;}
    if(!sdkLoaded){setStatus("error");setErr("⚠️ LIFF SDK 沒有載入\nindex.html 缺少 <script src=\"https://static.line-scdn.net/liff/edge/2/sdk.js\"></script>");return;}

    liff.init({liffId})
      .then(()=>{
        if(!liff.isLoggedIn()){liff.login();return;}
        return liff.getProfile();
      })
      .then(p=>{if(!p)return;onSuccess({name:sanitize(p.displayName,50)||"朋友",userId:p.userId,pictureUrl:p.pictureUrl});})
      .catch(e=>{
        console.error("LIFF error:",e);
        setStatus("error");
        const msg=e?.message||e?.code||String(e)||"未知錯誤";
        setErr(`LINE 登入失敗\n${msg}\n\n常見原因:\n• LIFF ID 錯誤 (檢查 Vercel 環境變數)\n• Endpoint URL 跟目前網址不符 (LINE Developers 後台設定)\n• LIFF 應用已停用`);
      });
  },[]);
  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:32,padding:32}}>
      {/* Logo 區 */}
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:11,letterSpacing:4,color:C.faint,textTransform:"uppercase",marginBottom:14}}>Welcome</div>
        <div style={{fontSize:30,fontWeight:300,color:C.text,letterSpacing:4}}>{APP_NAME}</div>
        <div style={{width:32,height:1,background:C.accent,margin:"16px auto 0"}}/>
      </div>

      {status==="error"
        ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,maxWidth:380,width:"100%"}}>
          <div style={{fontSize:12,color:C.red,padding:"14px 18px",background:C.redBg,borderRadius:C.rSm,whiteSpace:"pre-wrap",lineHeight:1.7,width:"100%",boxSizing:"border-box"}}>{err}</div>
          <details style={{fontSize:10,color:C.muted,width:"100%",background:C.bgDeep,borderRadius:8,padding:"8px 12px"}}>
            <summary style={{cursor:"pointer"}}>🔍 診斷資訊</summary>
            <div style={{marginTop:8,fontFamily:"monospace",wordBreak:"break-all"}}>
              <div>LIFF ID: {debug.liffId}</div>
              <div>SDK 載入: {debug.sdkLoaded?"✓":"✗"}</div>
              <div>網址: {window.location.href}</div>
              <div>UA: {debug.ua}</div>
            </div>
          </details>
          <button onClick={()=>window.location.reload()}
            style={{background:C.accent,color:"#fff",border:"none",borderRadius:99,padding:"12px 32px",fontSize:13,fontWeight:500,cursor:"pointer",letterSpacing:.5}}>
            重新整理
          </button>
         </div>
        :<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:20,width:"100%",maxWidth:280}}>
          {/* LINE 登入按鈕 */}
          <button onClick={()=>{
            const liffId=import.meta.env.VITE_LIFF_ID;
            if(!liffId){alert("未設定 LIFF ID,請聯絡管理員");return;}
            if(typeof liff==="undefined"){alert("LIFF SDK 未載入,請重新整理");return;}
            if(!liff.isLoggedIn()){liff.login();}
          }}
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:12,background:"#06C755",color:"#fff",border:"none",borderRadius:14,padding:"14px 24px",fontSize:15,fontWeight:600,cursor:"pointer",letterSpacing:.5,boxShadow:"0 4px 16px rgba(6,199,85,.25)"}}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
            </svg>
            使用 LINE 登入
          </button>

          {/* 載入中提示 */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:16,height:16,borderRadius:"50%",border:`1.5px solid ${C.faint}`,borderTopColor:C.accent,animation:"spin 1s linear infinite"}}/>
            <div style={{fontSize:12,color:C.faint,letterSpacing:.5}}>自動登入中</div>
          </div>
         </div>
      }

      <div style={{position:"absolute",bottom:32,fontSize:11,color:C.faint,letterSpacing:.5}}>Powered by Luna Studio</div>
    </div>
  );
}

// ─── 個人資料 Tab ─────────────────────────────────────────────────
function ProfileTab({member,setMember,lineUser,setToast,forced=false}){
  const [form,setForm]=useState({community_name:"",line_id:"",ig_threads:"",recipient_name:"",phone:"",seven_store:""});
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");

  useEffect(()=>{
    if(member?.line_user_id)setForm({community_name:member.community_name||"",line_id:member.line_id||"",ig_threads:member.ig_threads||"",recipient_name:member.recipient_name||"",phone:member.phone||"",seven_store:member.seven_store||""});
  },[member]);

  const save=async()=>{
    setErr("");
    if(!form.community_name.trim()){setErr("請填寫社群名稱");return;}
    if(!form.ig_threads.trim()){setErr("請填寫 IG / FB 連結");return;}
    if(!form.recipient_name.trim()){setErr("請填寫收件人姓名");return;}
    if(!form.phone.trim()){setErr("請填寫電話");return;}
    setSaving(true);
    const updated={line_user_id:lineUser.userId,line_name:lineUser.name,community_name:sanitize(form.community_name,100),line_id:sanitize(form.line_id,100),ig_threads:sanitize(form.ig_threads,200),recipient_name:sanitize(form.recipient_name,50),phone:sanitize(form.phone,20),seven_store:sanitize(form.seven_store,100),updated_at:new Date().toISOString()};
    try{
      const{error,data:savedRows}=await supabase.from("members").upsert([updated],{onConflict:"line_user_id"}).select();
      if(error)throw error;
      // 確認真的有寫入(回傳 0 筆 = RLS 擋住,但沒報錯)
      if(!savedRows||savedRows.length===0){
        throw new Error("資料未寫入(可能是權限設定問題,請聯絡客服)");
      }
      setMember(savedRows[0]||updated);
      setToast(forced?"歡迎加入,開始逛賣場吧 🎉":"資料已儲存 ✅");
    }catch(e){
      console.error("儲存失敗:",e);
      const msg=e?.message||"未知錯誤";
      setErr(`儲存失敗:${msg}`);
    }
    setSaving(false);
  };

  const FIELDS=[
    {key:"community_name",label:"社群名稱 *",placeholder:"OpenChat 顯示名稱",req:true},
    {key:"line_id",label:"LINE ID",placeholder:"你的 LINE ID"},
    {key:"ig_threads",label:"私人 IG / FB 連結 *",placeholder:"https://www.instagram.com/...",req:true},
    {key:"recipient_name",label:"收件人姓名 *",placeholder:"取件時的姓名",req:true},
    {key:"phone",label:"電話 *",placeholder:"09xxxxxxxx",req:true},
    {key:"seven_store",label:"7-11 門市",placeholder:"常用門市名稱"},
  ];

  return(
    <div style={{padding:"20px 16px 100px"}}>
      {forced&&(
        <div style={{padding:"14px 16px",background:C.accent,color:"#fff",borderRadius:C.rSm,marginBottom:18,boxShadow:C.shadow}}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>👋 歡迎,{lineUser.name}!</div>
          <div style={{fontSize:12,lineHeight:1.6,opacity:.95}}>首次使用請先填寫個人資料,完成後即可開始下單。後續可在「我的」隨時修改。</div>
        </div>
      )}
      {/* 頭像區 */}
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
        <div style={{width:56,height:56,borderRadius:"50%",background:C.accentBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>
          {lineUser.pictureUrl?<img src={lineUser.pictureUrl} style={{width:56,height:56,borderRadius:"50%",objectFit:"cover"}}/>:"👤"}
        </div>
        <div>
          <div style={{fontSize:17,fontWeight:600,color:C.text}}>{lineUser.name}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2,letterSpacing:.3}}>社群名稱務必填寫正確，改名也請到系統更改</div>
        </div>
      </div>

      <Card style={{padding:"20px"}}>
        <div style={{fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.7}}>
          <span style={{color:C.red,fontWeight:500}}>*</span> 為必填欄位
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {FIELDS.map(f=>(
            <div key={f.key}>
              <Field label={f.label} placeholder={f.placeholder} value={form[f.key]} onChange={v=>setForm(p=>({...p,[f.key]:v}))}/>
              {f.req&&!form[f.key].trim()&&<div style={{fontSize:11,color:C.red,marginTop:3}}>必填</div>}
            </div>
          ))}
        </div>
        {err&&<div style={{fontSize:12,color:C.red,marginTop:14,padding:"10px 14px",background:C.redBg,borderRadius:C.rSm}}>{err}</div>}
        <Btn full onClick={save} disabled={saving} style={{marginTop:20}}>{saving?"儲存中...":"儲存資料"}</Btn>
      </Card>
    </div>
  );
}

// ─── 商品 Tab ─────────────────────────────────────────────────────
function ProductDetailSheet({product,onAdd,onClose,rate}){
  const [selVariants,setSelVariants]=useState({});
  const [qty,setQty]=useState(1);
  if(!product)return null;
  const hasVariants=product.variants&&product.variants.length>0;
  const variantGroups=(()=>{
    if(!hasVariants)return[];
    const groups={};
    product.variants.forEach(v=>{
      const parts=v.name.includes(":")?v.name.split(":"):[" 款式",v.name];
      const g=parts[0],n=parts[1]||parts[0];
      if(!groups[g])groups[g]=[];
      groups[g].push({...v,label:n});
    });
    return Object.entries(groups);
  })();
  // 預設顯示:款式最低售價(讓客人一打開就看到價格)
  // 選了款式後:顯示被選中款式的售價
  const variantPrices=(product.variants||[]).map(v=>Number(v.price)||0).filter(x=>x>0);
  const minPrice=variantPrices.length?Math.min(...variantPrices):0;
  const maxPrice=variantPrices.length?Math.max(...variantPrices):0;
  const hasRange=variantPrices.length>1&&maxPrice>minPrice;

  let twdPrice=minPrice; // 預設顯示最低價
  let selectedDeposit=0; // 從選中款式讀取的訂金
  if(hasVariants){
    const selectedOpts=Object.entries(selVariants).map(([g,label])=>{
      const group=variantGroups.find(([gName])=>gName===g);
      return group?.[1]?.find(o=>o.label===label);
    }).filter(Boolean);
    if(selectedOpts.length>0){
      // 有選款式:顯示該款式的售價和訂金
      twdPrice=Math.max(...selectedOpts.map(o=>Number(o.price)||0));
      selectedDeposit=Math.max(...selectedOpts.map(o=>Number(o.deposit_amount)||0));
    }
  }
  const someSelected=Object.keys(selVariants).length>0;
  const allSelected=variantGroups.length===0||variantGroups.every(([g])=>selVariants[g]);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{background:C.bgDeep,aspectRatio:"4/3",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:18,overflow:"hidden",margin:"0 -22px"}}>
        {product.image?.startsWith("data:")||product.image?.startsWith("http")?<img src={product.image} alt={product.name} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>:<span style={{fontSize:72}}>{product.image||"🛒"}</span>}
      </div>
      <div>
        <div style={{fontSize:11,color:C.muted,letterSpacing:.5,marginBottom:4}}>{sanitize(product.category||"")}</div>
        <div style={{fontSize:20,fontWeight:600,color:C.text}}>{sanitize(product.name)}</div>
      </div>
      {twdPrice>0?(
        <div style={{background:C.accentBg,borderRadius:C.rSm,padding:"16px 18px"}}>
          <div style={{fontSize:24,fontWeight:700,color:C.accent}}>
            {someSelected||!hasRange
              ?fmtMoney(twdPrice)
              :`$${minPrice} - $${maxPrice}`}
          </div>
          {/* 付款方式提示 */}
          {product.payment_type === "deposit" && selectedDeposit > 0 ? (
            <div style={{fontSize:12,color:C.accent,marginTop:6,fontWeight:500}}>
              訂金 NT$ {selectedDeposit}
              <span style={{color:C.muted,fontWeight:400,marginLeft:6}}>
                尾款 NT$ {Math.max(0, (twdPrice||0) - selectedDeposit)} 取貨時付
              </span>
            </div>
          ) : product.payment_type === "deposit" ? (
            <div style={{fontSize:12,color:C.muted,marginTop:6}}>💰 先付訂金 · 請選擇款式查看訂金金額</div>
          ) : product.payment_type === "cod" ? (
            <div style={{fontSize:12,color:C.accent,marginTop:6,fontWeight:500}}>💰 貨到付款</div>
          ) : (
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>實際金額以業者確認為準</div>
          )}
        </div>
      ):(
        <div style={{background:C.accentBg,borderRadius:C.rSm,padding:"16px 18px"}}>
          <div style={{fontSize:14,color:C.muted}}>價格洽詢</div>
        </div>
      )}

      {/* 結單日期 / 預計到貨 */}
      {(product.deadline || product.expected_arrival) && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {product.deadline && (
            <div style={{ flex:1, minWidth:130, background:C.bgDeep, borderRadius:C.rSm, padding:"10px 12px", border:`1px solid ${C.borderLight}` }}>
              <div style={{ fontSize:10, color:C.faint, letterSpacing:.5, marginBottom:3, fontWeight:600 }}>⏰ 結單日期</div>
              <div style={{ fontSize:13, color:C.text, fontWeight:500 }}>{formatShortDate(product.deadline)}</div>
            </div>
          )}
          {product.expected_arrival && (
            <div style={{ flex:1, minWidth:130, background:C.bgDeep, borderRadius:C.rSm, padding:"10px 12px", border:`1px solid ${C.borderLight}` }}>
              <div style={{ fontSize:10, color:C.faint, letterSpacing:.5, marginBottom:3, fontWeight:600 }}>📦 預計到貨</div>
              <div style={{ fontSize:13, color:C.text, fontWeight:500 }}>{formatShortDate(product.expected_arrival)}</div>
            </div>
          )}
        </div>
      )}
      {variantGroups.map(([groupName,options])=>(
        <div key={groupName}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:8,color:C.textMid}}>{groupName}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {options.map(o=>{
              const sel=selVariants[groupName]===o.label;
              return(
                <button key={o.id} onClick={()=>setSelVariants(p=>({...p,[groupName]:o.label}))}
                  style={{padding:"8px 16px",borderRadius:99,fontSize:13,cursor:"pointer",transition:"all .15s",border:`1.5px solid ${sel?C.accent:C.border}`,background:sel?C.accentBg:"transparent",color:sel?C.accent:C.textMid,fontWeight:sel?500:400}}>
                  {o.label}{o.price>0?` $${o.price}`:""}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div>
        <div style={{fontSize:13,fontWeight:500,marginBottom:12,color:C.textMid}}>數量</div>
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{width:40,height:40,borderRadius:"50%",background:C.bgDeep,border:`1px solid ${C.border}`,fontSize:20,cursor:"pointer"}}>−</button>
          <div style={{fontSize:20,fontWeight:600,minWidth:32,textAlign:"center"}}>{qty}</div>
          <button onClick={()=>setQty(q=>Math.min(99,q+1))} style={{width:40,height:40,borderRadius:"50%",background:C.bgDeep,border:`1px solid ${C.border}`,fontSize:20,cursor:"pointer"}}>+</button>
          {twdPrice>0&&<div style={{marginLeft:"auto",fontSize:12,color:C.muted}}>小計 <span style={{color:C.accent,fontWeight:600,fontSize:14}}>{fmtMoney(twdPrice*qty)}</span></div>}
        </div>
      </div>
      <Btn full disabled={!allSelected} onClick={()=>{
        const varLabel=Object.entries(selVariants).map(([g,v])=>`${g}:${v}`).join(" / ");
        const itemName=`${sanitize(product.name)}${varLabel?` / ${varLabel}`:""}`;
        const cartId=product.id+JSON.stringify(selVariants);
        for(let i=0;i<qty;i++)onAdd({
          ...product,
          id:cartId,
          name:itemName,
          price:safePrice(twdPrice),
          payment_type: product.payment_type || "full",
          deposit_amount: selectedDeposit || 0,  // 用選中款式的訂金
        });
        onClose();
      }}>{!allSelected?"請選擇規格":"加入購物車"}</Btn>
    </div>
  );
}

function CatalogTab({products,inStock,rate,cart,onAdd,showCart,setShowCart,updateCartQty,removeFromCart,submitOrder,autoCancelHours=36}){
  const [activeCategory,setActiveCategory]=useState("全部");
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState(null);
  const [selectedInStock,setSelectedInStock]=useState(null);
  const [showManual,setShowManual]=useState(false);
  const [mName,setMName]=useState("");
  const [mPrice,setMPrice]=useState("");
  const [payAmount,setPayAmount]=useState("");
  const [payLast5,setPayLast5]=useState("");
  const [payBank,setPayBank]=useState("");

  const doSubmit=()=>{
    // 驗證匯款資訊必填
    if (!payBank) { alert("請選擇匯款銀行"); return; }
    if (!payAmount || Number(payAmount) <= 0) { alert("請填寫匯款金額"); return; }
    if (!payLast5 || payLast5.length !== 5) { alert("請填寫完整 5 碼帳號末碼"); return; }
    submitOrder({
      payAmount: Number(payAmount) || 0,
      payLast5: payLast5 || "",
      payBank: payBank || "",
    });
    setPayAmount("");
    setPayLast5("");
    setPayBank("");
  };

  const inCart=id=>cart.find(c=>c.id===id);
  const activeProducts=products.filter(p=>p.status==="on");
  const activeInStock=(inStock||[]).filter(i=>i.status==="on");
  const categories=["全部",...Array.from(new Set(activeProducts.map(p=>p.category).filter(Boolean)))];
  const filtered=activeProducts.filter(p=>activeCategory==="全部"||p.category===activeCategory).filter(p=>!search||sanitize(p.name).includes(search)||sanitize(p.category||"").includes(search));

  const ProductCard=({p,isInStock,idx})=>{
    const qtyInCart=inCart(p.id)?.qty;
    // 取所有款式售價中的最小值(沒款式或都 0 則為 0)
    const variantPrices=(p.variants||[]).map(v=>Number(v.price)||0).filter(x=>x>0);
    const minPrice=variantPrices.length?Math.min(...variantPrices):0;
    const hasMultiple=variantPrices.length>1&&Math.max(...variantPrices)>minPrice;
    return(
      <div className="fadeUp" style={{animationDelay:`${idx*.03}s`,background:C.bgCard,borderRadius:16,overflow:"hidden",cursor:"pointer",border:`1px solid ${C.borderLight}`,boxShadow:C.shadow}} onClick={()=>isInStock?setSelectedInStock(p):setSelected(p)}>
        <div style={{background:C.bgDeep,aspectRatio:"1/1",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
          {p.image?.startsWith("data:")||p.image?.startsWith("http")?<img src={p.image} alt={p.name} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>:<span style={{fontSize:36}}>{p.image||"🛒"}</span>}
          {isInStock&&<span style={{position:"absolute",top:8,left:8,background:C.green,color:"#fff",fontSize:9,padding:"2px 7px",borderRadius:99,fontWeight:600,letterSpacing:.3}}>現貨</span>}
          {qtyInCart&&<span style={{position:"absolute",top:8,right:8,background:C.accent,color:"#fff",fontSize:10,width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{qtyInCart}</span>}
        </div>
        <div style={{padding:"10px 12px 12px"}}>
          <div style={{fontSize:10,color:C.faint,marginBottom:3,letterSpacing:.3}}>{sanitize(p.category||"")}</div>
          <div style={{fontSize:12,lineHeight:1.4,color:C.text,marginBottom:5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{sanitize(p.name)}</div>
          {minPrice>0?<div style={{fontSize:13,fontWeight:600,color:C.accent}}>{hasMultiple?`$${minPrice} - $${Math.max(...variantPrices)}`:fmtMoney(minPrice)}</div>:<div style={{fontSize:11,color:C.faint}}>洽詢定價</div>}
        </div>
      </div>
    );
  };

  return(
    <div style={{padding:"16px 16px 100px",display:"flex",flexDirection:"column",gap:16}}>
      {/* 搜尋 */}
      <div style={{position:"relative"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋商品..."
          style={{width:"100%",background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:99,padding:"11px 16px 11px 42px",fontSize:13,color:C.text,boxShadow:C.shadow}}
          onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
        <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",color:C.faint,fontSize:16}}>🔍</span>
        {search&&<button onClick={()=>setSearch("")} style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.faint,fontSize:18,cursor:"pointer"}}>×</button>}
      </div>

      {/* 分類 */}
      <div style={{display:"flex",gap:8,overflowX:"auto",scrollbarWidth:"none",paddingBottom:2}}>
        {categories.map(cat=>(
          <button key={cat} onClick={()=>setActiveCategory(cat)} style={{padding:"7px 16px",borderRadius:99,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",transition:"all .15s",border:`1.5px solid ${activeCategory===cat?C.accent:C.border}`,background:activeCategory===cat?C.accentBg:"transparent",color:activeCategory===cat?C.accent:C.muted,fontWeight:activeCategory===cat?500:400}}>
            {cat}
          </button>
        ))}
      </div>

      {/* 現貨 */}
      {activeInStock.length>0&&(
        <div>
          <div style={{fontSize:12,color:C.muted,letterSpacing:.5,marginBottom:10,fontWeight:500}}>— 現貨商品 —</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {activeInStock.map((p,i)=><ProductCard key={p.id} p={p} isInStock idx={i}/>)}
          </div>
        </div>
      )}

      {/* 一般商品 */}
      <div>
        <div style={{fontSize:12,color:C.muted,letterSpacing:.5,marginBottom:10,fontWeight:500}}>— 可直接下單 —</div>
        {filtered.length===0
          ?<div style={{textAlign:"center",padding:"40px 0",color:C.faint,fontSize:13}}>找不到商品</div>
          :<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {filtered.map((p,i)=><ProductCard key={p.id} p={p} isInStock={false} idx={i}/>)}
          </div>
        }
      </div>

      {/* 手動輸入 */}
      <Card style={{padding:"16px"}}>
        <div style={{fontSize:12,color:C.muted,marginBottom:10}}>找不到商品？手動填寫</div>
        {!showManual
          ?<button onClick={()=>setShowManual(true)} style={{background:C.bgDeep,border:`1px solid ${C.border}`,borderRadius:99,padding:"8px 20px",fontSize:12,color:C.textMid,cursor:"pointer"}}>+ 手動輸入</button>
          :<div style={{display:"flex",flexDirection:"column",gap:10}}>
            <Field label="商品名稱 *" value={mName} onChange={v=>setMName(v.slice(0,100))} placeholder="商品名稱、規格、顏色…"/>
            <Field label="金額（NT$）" type="number" value={mPrice} onChange={setMPrice} placeholder="0"/>
            <div style={{display:"flex",gap:8}}>
              <Btn full onClick={()=>{const n=sanitize(mName,100);if(!n)return;onAdd({id:secureUid(),name:n,price:safePrice(mPrice),image:"",category:"手動輸入"});setShowManual(false);setMName("");setMPrice("");}}>加入購物車</Btn>
              <Btn variant="outline" sm onClick={()=>setShowManual(false)}>取消</Btn>
            </div>
          </div>
        }
      </Card>

      {/* Product Sheets */}
      <Sheet open={!!selected} onClose={()=>setSelected(null)} title={selected?sanitize(selected.name):""}>
        {selected&&<ProductDetailSheet product={selected} onAdd={onAdd} onClose={()=>setSelected(null)} rate={rate}/>}
      </Sheet>
      <Sheet open={!!selectedInStock} onClose={()=>setSelectedInStock(null)} title={selectedInStock?sanitize(selectedInStock.name):""}>
        {selectedInStock&&<ProductDetailSheet product={selectedInStock} onAdd={onAdd} onClose={()=>setSelectedInStock(null)} rate={rate}/>}
      </Sheet>

      {/* 購物車 Sheet */}
      <Sheet open={showCart} onClose={()=>setShowCart(false)} title="購物車">
        <div style={{display:"flex",flexDirection:"column"}}>
          {cart.length===0
            ?<div style={{textAlign:"center",padding:"40px 0",color:C.faint}}>購物車是空的</div>
            :<>
              {cart.map((item,i)=>(
                <div key={item.id}>
                  <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 0"}}>
                    <div style={{width:48,height:48,background:C.bgDeep,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,overflow:"hidden"}}>
                      {item.image?.startsWith("data:")||item.image?.startsWith("http")
                        ?<img src={item.image} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>
                        :item.image||"🛒"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      {(()=>{const {mainName,variants}=parseItemName(item.name);return(<>
                        <div style={{fontSize:13,fontWeight:500,color:C.text}}>{mainName}</div>
                        {variants.map((v,vi)=>(
                          <div key={vi} style={{fontSize:11,color:C.muted,marginTop:1}}>
                            {v.label&&<span style={{color:C.faint,marginRight:3}}>{v.label}</span>}{v.value}
                          </div>
                        ))}
                        <div style={{fontSize:12,color:C.accent,marginTop:2}}>{item.price>0?fmtMoney(item.price):"洽詢"} × {item.qty}</div>
                      </>)})()}
                    </div>
                    <div style={{display:"flex",alignItems:"center",flexShrink:0}}>
                      <button onClick={()=>updateCartQty(item.id,-1)} style={{width:28,height:28,border:`1px solid ${C.border}`,borderRadius:"8px 0 0 8px",background:C.bgDeep,color:C.textMid,fontSize:16,cursor:"pointer"}}>−</button>
                      <div style={{width:32,textAlign:"center",fontSize:13,border:`1px solid ${C.border}`,borderLeft:"none",borderRight:"none",height:28,lineHeight:"28px"}}>{item.qty}</div>
                      <button onClick={()=>updateCartQty(item.id,1)} style={{width:28,height:28,border:`1px solid ${C.border}`,borderRadius:"0 8px 8px 0",background:C.bgDeep,color:C.textMid,fontSize:16,cursor:"pointer"}}>+</button>
                    </div>
                    <button onClick={()=>removeFromCart(item.id)} style={{background:"none",border:"none",color:C.faint,fontSize:20,cursor:"pointer"}}>×</button>
                  </div>
                  {i<cart.length-1&&<HR/>}
                </div>
              ))}
              {/* 金額明細 */}
              {(()=>{
                const subtotal = cart.reduce((s,c)=>s+safePrice(c.price)*safeQty(c.qty),0);
                let depositSum = 0;   // 訂金總和(先付訂金的商品)
                let fullPaySum = 0;   // 付全款總和(現在要付)
                let codSum = 0;       // 貨到付款總和(到貨才付)
                let remainSum = 0;    // 尾款總和(訂金商品的剩餘)
                cart.forEach(c => {
                  const pt = c.payment_type || "full";
                  const total = safePrice(c.price) * safeQty(c.qty);
                  if (pt === "deposit") {
                    const dep = (Number(c.deposit_amount)||0) * safeQty(c.qty);
                    const actualDep = Math.min(dep, total);
                    depositSum += actualDep;
                    remainSum += Math.max(0, total - actualDep);
                  } else if (pt === "cod") {
                    codSum += total;
                  } else {
                    fullPaySum += total;
                  }
                });
                const payNow = depositSum + fullPaySum;
                const payLater = remainSum + codSum;
                return (
                  <div style={{background:C.bgDeep,borderRadius:C.rSm,padding:"14px 16px",marginBottom:12,marginTop:8,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:10,letterSpacing:.5,fontWeight:600}}>金額明細</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                        <span style={{color:C.textMid}}>商品小計</span>
                        <span style={{color:C.text}}>{fmtMoney(subtotal)}</span>
                      </div>
                      {depositSum>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                          <span style={{color:C.textMid}}>訂金(現在付)</span>
                          <span style={{color:C.accent,fontWeight:600}}>{fmtMoney(depositSum)}</span>
                        </div>
                      )}
                      {fullPaySum>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
                          <span style={{color:C.textMid}}>全款(現在付)</span>
                          <span style={{color:C.accent,fontWeight:600}}>{fmtMoney(fullPaySum)}</span>
                        </div>
                      )}
                      {remainSum>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted}}>
                          <span>尾款(取貨時付)</span>
                          <span>{fmtMoney(remainSum)}</span>
                        </div>
                      )}
                      {codSum>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted}}>
                          <span>貨到付款</span>
                          <span>{fmtMoney(codSum)}</span>
                        </div>
                      )}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0 0",borderTop:`1px solid ${C.border}`,marginTop:6}}>
                        <span style={{fontSize:14,fontWeight:600,color:C.text}}>現在應付</span>
                        <span style={{fontSize:20,fontWeight:700,color:C.accent}}>{fmtMoney(payNow)}</span>
                      </div>
                      {payLater>0 && (
                        <div style={{fontSize:10,color:C.muted,textAlign:"right",lineHeight:1.5}}>
                          尾款 {fmtMoney(payLater)} 於商品到貨時付
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 付款資訊輸入 (必填) */}
              <div style={{background:C.bgDeep,borderRadius:C.rSm,padding:"14px 16px",marginBottom:12,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:10,letterSpacing:.5,fontWeight:600}}>💰 匯款資訊 <span style={{color:C.accent,fontWeight:400}}>(必填)</span></div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div>
                    <label style={{fontSize:11,color:C.textMid,display:"block",marginBottom:4}}>付款銀行 *</label>
                    <select value={payBank} onChange={e=>setPayBank(e.target.value)}
                      style={{width:"100%",padding:"9px 12px",border:`1px solid ${payBank?C.border:C.accent}`,borderRadius:8,fontSize:14,boxSizing:"border-box",background:"#fff",color:payBank?C.text:C.muted,cursor:"pointer",WebkitAppearance:"none",appearance:"none",backgroundImage:`url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 12px center",backgroundSize:"14px",paddingRight:36}}>
                      <option value="">請選擇銀行</option>
                      {TW_BANKS.map(b => (
                        <option key={b.code} value={`${b.code} ${b.name}`}>{b.code} {b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:C.textMid,display:"block",marginBottom:4}}>匯款金額 NT$ *</label>
                    <input type="number" inputMode="numeric" value={payAmount} onChange={e=>setPayAmount(e.target.value)}
                      placeholder="例如:500"
                      style={{width:"100%",padding:"9px 12px",border:`1px solid ${payAmount?C.border:C.accent}`,borderRadius:8,fontSize:14,boxSizing:"border-box",background:"#fff",color:C.text}}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:C.textMid,display:"block",marginBottom:4}}>匯款帳號末 5 碼 *</label>
                    <input type="text" inputMode="numeric" maxLength={5} value={payLast5} onChange={e=>setPayLast5(e.target.value.replace(/\D/g,"").slice(0,5))}
                      placeholder="例如:12345"
                      style={{width:"100%",padding:"9px 12px",border:`1px solid ${payLast5.length===5?C.border:C.accent}`,borderRadius:8,fontSize:14,boxSizing:"border-box",background:"#fff",color:C.text,letterSpacing:2}}/>
                  </div>
                  <div style={{fontSize:10,color:C.accent,lineHeight:1.6,padding:"4px 2px",background:C.accentBg,borderRadius:6,padding:"8px 10px"}}>
                    ⚠️ 匯款資訊為必填,若下單後 {autoCancelHours} 小時內業者未收到匯款資訊,系統將自動取消訂單。
                  </div>
                </div>
              </div>

              <Btn full onClick={doSubmit}>確認送出訂單</Btn>
              <div style={{fontSize:11,color:C.faint,textAlign:"center",marginTop:12,lineHeight:1.8}}>送出後業者確認並與您聯繫<br/>代購最終價格以業者報價為準</div>
            </>
          }
        </div>
      </Sheet>
    </div>
  );
}

// ─── 許願 Tab ─────────────────────────────────────────────────────
function WishlistTab({wishes,onAddWish,onDeleteWish,onAddToCart,setTab}){
  const [name,setName]=useState("");
  const [note,setNote]=useState("");
  const [imgUrl,setImgUrl]=useState("");
  const [imgFile,setImgFile]=useState(null);
  const [imgPreview,setImgPreview]=useState("");
  const [link,setLink]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [showForm,setShowForm]=useState(false);

  const handleFileChange=async(e)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    if(file.size>5*1024*1024){alert("圖片大小請勿超過 5MB");return;}
    setImgFile(file);setImgUrl("");
    const reader=new FileReader();
    reader.onload=ev=>setImgPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const uploadImage=async()=>{
    if(!imgFile)return imgUrl||"";
    setUploading(true);
    const ext=imgFile.name.split(".").pop();
    const path=`${secureUid()}.${ext}`;
    const{error}=await supabase.storage.from("wishlist-images").upload(path,imgFile,{contentType:imgFile.type});
    setUploading(false);
    if(error){alert("圖片上傳失敗");return "";}
    const{data}=supabase.storage.from("wishlist-images").getPublicUrl(path);
    return data.publicUrl||"";
  };

  const submit=async()=>{
    if(!name.trim())return;
    setSubmitting(true);
    const uploadedUrl=await uploadImage();
    await onAddWish(name,note,uploadedUrl||imgUrl,link);
    setName("");setNote("");setImgUrl("");setImgFile(null);setImgPreview("");setLink("");
    setShowForm(false);setSubmitting(false);
  };

  const inp={width:"100%",background:C.surface,border:`1.5px solid ${C.border}`,borderRadius:C.rSm,padding:"11px 14px",fontSize:13,color:C.text,fontFamily:"'Noto Sans TC',sans-serif"};

  return(
    <div style={{padding:"16px 16px 100px",display:"flex",flexDirection:"column",gap:14}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:17,fontWeight:600,color:C.text}}>許願清單</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2,lineHeight:1.6}}>想連線或找的品項，Luna 報價後可直接下單 🌸</div>
        </div>
        <button onClick={()=>setShowForm(v=>!v)} style={{background:showForm?C.bgDeep:C.accent,color:showForm?C.muted:"#fff",border:"none",borderRadius:99,padding:"8px 18px",fontSize:12,cursor:"pointer",fontWeight:500}}>
          {showForm?"取消":"+ 新增"}
        </button>
      </div>

      {/* 新增表單 */}
      {showForm&&(
        <Card style={{padding:"18px"}} className="fadeUp">
          <div style={{fontSize:12,color:C.muted,marginBottom:14}}>可以直接丟商品名稱、圖片、連結</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="想看的商品名稱 *" style={inp}
              onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
            <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="補充描述（可選）" rows={2} style={{...inp,resize:"none"}}
              onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
            <div>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>上傳圖片（可選）</div>
              <label style={{display:"block",cursor:"pointer"}}>
                <div style={{border:`1.5px dashed ${imgPreview?C.accent:C.border}`,borderRadius:C.rSm,padding:"14px",textAlign:"center",background:C.bgDeep}}>
                  {imgPreview?<img src={imgPreview} alt="預覽" style={{width:"100%",maxHeight:140,objectFit:"cover",borderRadius:8}}/>
                    :<><div style={{fontSize:20,marginBottom:4}}>📷</div><div style={{fontSize:12,color:C.faint}}>點擊上傳 JPG / PNG（max 5MB）</div></>}
                </div>
                <input type="file" accept="image/*" onChange={handleFileChange} style={{display:"none"}}/>
              </label>
              {imgPreview&&<button onClick={()=>{setImgFile(null);setImgPreview("");}} style={{fontSize:11,color:C.red,background:"none",border:"none",cursor:"pointer",marginTop:4}}>✕ 移除</button>}
            </div>
            {!imgFile&&(
              <input value={imgUrl} onChange={e=>setImgUrl(e.target.value)} placeholder="或貼上圖片網址 https://..." style={inp}
                onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
            )}
            <input value={link} onChange={e=>setLink(e.target.value)} placeholder="商品連結（可選）" style={inp}
              onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
            <Btn full onClick={submit} disabled={submitting||uploading||!name.trim()}>
              {uploading?"上傳中...":submitting?"送出中...":"發起許願"}
            </Btn>
          </div>
        </Card>
      )}

      {/* 許願列表 */}
      {!wishes.length
        ?<Card style={{padding:"40px 20px",textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>✨</div><div style={{fontSize:13,color:C.faint}}>還沒有許願商品</div></Card>
        :<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {wishes.map((w,i)=>{
            const isFound=w.status==="found";
            const hasPrice=isFound&&w.price>0;
            return(
              <Card key={w.id} className="fadeUp" style={{animationDelay:`${i*.04}s`,padding:"16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:isFound?12:0}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:500,color:C.text,marginBottom:3}}>{w.name}</div>
                    {w.note&&<div style={{fontSize:12,color:C.muted}}>{w.note}</div>}
                    {w.link&&<a href={w.link} target="_blank" rel="noreferrer" style={{fontSize:11,color:C.accent,marginTop:4,display:"block",wordBreak:"break-all"}}>🔗 {w.link}</a>}
                    {w.img_url&&<img src={w.img_url} alt="參考" style={{width:"100%",maxHeight:120,objectFit:"cover",borderRadius:10,marginTop:8,border:`1px solid ${C.borderLight}`}} onError={e=>e.target.style.display="none"}/>}
                  </div>
                  <span style={{fontSize:11,border:`1px solid ${isFound?C.green:C.border}`,color:isFound?C.green:C.muted,padding:"3px 10px",borderRadius:99,whiteSpace:"nowrap",flexShrink:0}}>
                    {isFound?"已找到":"許願中"}
                  </span>
                </div>
                {isFound&&(
                  <div style={{background:C.greenBg,borderRadius:C.rSm,padding:"12px 14px",border:`1px solid ${C.green}20`,marginBottom:10}}>
                    {hasPrice&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{fontSize:12,color:C.muted}}>Luna 報價</div><div style={{fontSize:17,fontWeight:700,color:C.green}}>{fmtMoney(w.price)}</div></div>}
                    {w.found_note&&<div style={{fontSize:12,color:C.textMid,marginBottom:10,lineHeight:1.6}}>{w.found_note}</div>}
                    <Btn full sm onClick={()=>{onAddToCart({id:w.id+"_wish",name:w.name,price:hasPrice?w.price:0,image:w.img_url||"",category:"許願商品"});setTab("catalog");}}>加入購物車下單</Btn>
                  </div>
                )}
                <button onClick={()=>{if(window.confirm("確定要刪除這個許願嗎？"))onDeleteWish(w.id);}}
                  style={{fontSize:11,color:C.faint,background:"none",border:`1px solid ${C.borderLight}`,borderRadius:99,padding:"4px 12px",cursor:"pointer"}}>
                  刪除許願
                </button>
              </Card>
            );
          })}
        </div>
      }
    </div>
  );
}

// ─── 訂單 Tab ─────────────────────────────────────────────────────
function OrdersTab({orders}){
  const [filter,setFilter]=useState("all");

  const STEPS=[
    {key:"pending_review",label:"待審核"},
    {key:"pending",label:"待採購"},
    {key:"bought",label:"已採購"},
    {key:"shipped",label:"已寄出"},
    {key:"arrived",label:"已到台"},
  ];

  const shipped=["shipped","arrived"];
  const filtered=orders.filter(o=>{
    if(filter==="unshipped")return!shipped.includes(o.status)&&o.status!=="cancelled";
    if(filter==="shipped"){const d=new Date();d.setMonth(d.getMonth()-3);return shipped.includes(o.status)&&new Date(o.created_at||o.createdAt)>d;}
    return true;
  });

  return(
    <div style={{padding:"16px 16px 100px",display:"flex",flexDirection:"column",gap:14}}>
      {/* 篩選 */}
      <div style={{display:"flex",alignItems:"center",gap:8,overflowX:"auto",scrollbarWidth:"none"}}>
        {[["all","全部"],["unshipped","未出貨"],["shipped","已出貨"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{padding:"7px 16px",borderRadius:99,fontSize:12,whiteSpace:"nowrap",cursor:"pointer",transition:"all .15s",border:`1.5px solid ${filter===v?C.accent:C.border}`,background:filter===v?C.accentBg:"transparent",color:filter===v?C.accent:C.muted,fontWeight:filter===v?500:400}}>
            {l}
          </button>
        ))}
        <div style={{marginLeft:"auto",fontSize:12,color:C.faint,whiteSpace:"nowrap"}}>{filtered.length} 筆</div>
      </div>

      {!filtered.length
        ?<Card style={{padding:"40px 20px",textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>📋</div><div style={{fontSize:13,color:C.faint}}>目前沒有符合條件的訂單</div></Card>
        :filtered.map((o,i)=>{
          const createdDate=o.created_at?new Date(o.created_at).toLocaleDateString("zh-TW"):(o.createdAt||"");
          const curIdx=STEPS.findIndex(s=>s.key===o.status);
          const isCancelled=o.status==="cancelled";
          const isArrived=o.status==="arrived";

          return(
            <Card key={o.id} className="fadeUp" style={{animationDelay:`${i*.04}s`,overflow:"hidden"}}>
              {/* Header */}
              <div style={{padding:"16px 18px 14px",borderBottom:`1px solid ${C.borderLight}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{fontSize:11,color:C.faint,letterSpacing:.3}}>#{o.no} · {createdDate}</div>
                  <StatusPill status={o.status}/>
                </div>
                <div style={{fontSize:14,fontWeight:600,color:C.text}}>
                  {parseItemName(o.items?.[0]?.name).mainName}{(o.items?.length||0)>1?` 外 ${o.items.length-1} 項`:""}
                </div>
              </div>

              {/* 已取消 */}
              {isCancelled&&(
                <div style={{padding:"14px 18px",background:C.redBg}}>
                  <div style={{fontSize:12,color:C.red}}>此訂單已取消</div>
                </div>
              )}

              {/* 已到台：顯示品項明細 + 整筆進度條 */}
              {!isCancelled&&isArrived&&(
                <div style={{padding:"16px 18px"}}>
                  {/* 整筆訂單進度條 */}
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:0}}>
                      {STEPS.map((s,si)=>{
                        const done=si<=curIdx;
                        return(
                          <div key={s.key} style={{display:"flex",alignItems:"center",flex:si<STEPS.length-1?1:0}}>
                            <div style={{width:done?10:8,height:done?10:8,borderRadius:"50%",background:done?C.accent:C.borderLight,flexShrink:0,transition:"all .3s"}}/>
                            {si<STEPS.length-1&&<div style={{flex:1,height:2,background:si<curIdx?C.accent:C.borderLight,transition:"background .4s"}}/>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                      <div style={{fontSize:9,color:C.accent,fontWeight:600}}>待審核</div>
                      <div style={{fontSize:9,color:C.accent,fontWeight:700}}>🎁 已到台</div>
                    </div>
                  </div>
                  {/* 品項明細 */}
                  <div style={{borderTop:`1px solid ${C.borderLight}`,paddingTop:12}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:10,letterSpacing:.3}}>訂單品項</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {(o.items||[]).map((it,idx)=>(
                        <div key={idx} style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:36,height:36,borderRadius:8,background:C.bgDeep,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,overflow:"hidden"}}>
                            {it.image?.startsWith("data:")||it.image?.startsWith("http")?<img src={it.image} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>:it.image||"🛒"}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            {(()=>{const {mainName,variants}=parseItemName(it.name);return(<>
                              <div style={{fontSize:13,fontWeight:500,color:C.text}}>{mainName}</div>
                              {variants.map((v,vi)=>(
                                <div key={vi} style={{fontSize:11,color:C.muted,marginTop:2}}>
                                  {v.label&&<span style={{color:C.faint,marginRight:3}}>{v.label}</span>}{v.value}
                                </div>
                              ))}
                            </>)})()}
                          </div>
                          <div style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>×{it.qty}</div>
                          {it.price>0&&<div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap"}}>{fmtMoney(it.price*it.qty)}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 其他狀態：每個品項獨立進度條 */}
              {!isCancelled&&!isArrived&&curIdx>=0&&(
                <div style={{padding:"0 18px 4px"}}>
                  {(o.items||[]).map((it,ii)=>{
                    const itemStatus=it.status||o.status||"pending_review";
                    const itemIdx=STEPS.findIndex(s=>s.key===itemStatus);
                    const itemCancelled=itemStatus==="cancelled";
                    return(
                      <div key={ii} style={{borderBottom:ii<(o.items||[]).length-1?`1px solid ${C.borderLight}`:"none",padding:"14px 0"}}>
                        {/* 品項 header */}
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                          <div style={{width:36,height:36,borderRadius:8,background:C.bgDeep,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,overflow:"hidden"}}>
                            {it.image?.startsWith("data:")||it.image?.startsWith("http")?<img src={it.image} style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>:it.image||"🛒"}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            {(()=>{const {mainName,variants}=parseItemName(it.name);return(<>
                              <div style={{fontSize:13,fontWeight:500,color:C.text}}>{mainName}</div>
                              {variants.map((v,vi)=>(
                                <div key={vi} style={{fontSize:11,color:C.muted,marginTop:1}}>
                                  {v.label&&<span style={{color:C.faint,marginRight:3}}>{v.label}</span>}{v.value}
                                </div>
                              ))}
                              <div style={{fontSize:11,color:C.muted,marginTop:2}}>×{it.qty}{it.price>0?` · ${fmtMoney(it.price*it.qty)}`:""}</div>
                            </>)})()}
                          </div>
                          <StatusPill status={itemStatus}/>
                        </div>
                        {/* 韓系簡約進度條 */}
                        {!itemCancelled&&itemIdx>=0&&(
                          <div>
                            <div style={{display:"flex",alignItems:"center"}}>
                              {STEPS.map((s,si)=>{
                                const done=si<itemIdx,active=si===itemIdx,future=si>itemIdx;
                                return(
                                  <div key={s.key} style={{display:"flex",alignItems:"center",flex:si<STEPS.length-1?1:0}}>
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                      <div style={{width:active?18:12,height:active?18:12,borderRadius:"50%",background:done?C.accent:active?C.bgDark:C.borderLight,border:`1.5px solid ${done||active?C.accent:C.borderLight}`,flexShrink:0,boxShadow:active?`0 2px 8px ${C.accent}40`:"none",transition:"all .3s",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                        {done&&<div style={{width:5,height:5,borderRadius:"50%",background:"#fff"}}/>}
                                        {active&&<div style={{width:6,height:6,borderRadius:"50%",background:"#fff"}}/>}
                                      </div>
                                      <div style={{fontSize:9,color:active?C.accent:done?C.accentLight:C.faint,fontWeight:active?600:400,whiteSpace:"nowrap",letterSpacing:.2}}>{s.label}</div>
                                    </div>
                                    {si<STEPS.length-1&&<div style={{flex:1,height:1.5,background:done?C.accent:C.borderLight,margin:"0 3px",marginBottom:14,borderRadius:99,transition:"background .4s"}}/>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {itemCancelled&&<div style={{fontSize:11,color:C.red,marginTop:4}}>此品項已取消</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Footer */}
              <div style={{padding:"12px 18px",borderTop:`1px solid ${C.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:C.bgDeep}}>
                <div style={{fontSize:11,color:C.muted}}>{(o.items||[]).length} 項商品</div>
                <div style={{fontSize:15,fontWeight:700,color:C.text}}>{fmtMoney(o.total)}</div>
              </div>
            </Card>
          );
        })
      }
    </div>
  );
}

// ─── 出貨 Tab ─────────────────────────────────────────────────────
// (賣貨便連結改從 Supabase settings 表讀取)

// 台灣銀行清單(含代號)
const TW_BANKS = [
  { code: "004", name: "臺灣銀行" },
  { code: "005", name: "土地銀行" },
  { code: "006", name: "合作金庫" },
  { code: "007", name: "第一銀行" },
  { code: "008", name: "華南銀行" },
  { code: "009", name: "彰化銀行" },
  { code: "011", name: "上海商銀" },
  { code: "012", name: "台北富邦" },
  { code: "013", name: "國泰世華" },
  { code: "016", name: "高雄銀行" },
  { code: "017", name: "兆豐銀行" },
  { code: "018", name: "農業金庫" },
  { code: "021", name: "花旗(台灣)" },
  { code: "025", name: "首都銀行" },
  { code: "039", name: "澳盛銀行" },
  { code: "040", name: "中華開發" },
  { code: "050", name: "臺灣企銀" },
  { code: "052", name: "渣打銀行" },
  { code: "053", name: "台中商銀" },
  { code: "054", name: "京城銀行" },
  { code: "081", name: "匯豐(台灣)" },
  { code: "101", name: "瑞興銀行" },
  { code: "102", name: "華泰銀行" },
  { code: "103", name: "臺灣新光商銀" },
  { code: "108", name: "陽信銀行" },
  { code: "118", name: "板信銀行" },
  { code: "147", name: "三信商銀" },
  { code: "700", name: "中華郵政" },
  { code: "803", name: "聯邦銀行" },
  { code: "805", name: "遠東銀行" },
  { code: "806", name: "元大銀行" },
  { code: "807", name: "永豐銀行" },
  { code: "808", name: "玉山銀行" },
  { code: "809", name: "凱基銀行" },
  { code: "810", name: "星展(台灣)" },
  { code: "812", name: "台新銀行" },
  { code: "815", name: "日盛銀行" },
  { code: "816", name: "安泰銀行" },
  { code: "822", name: "中國信託" },
  { code: "823", name: "將來銀行" },
  { code: "824", name: "連線銀行(LINE Bank)" },
  { code: "826", name: "樂天國際銀行" },
];

function ShipmentsTab({orders, shopeeUrl}){
  const [filter,setFilter]=useState("active"); // active=進行中 / done=已完成
  const canCheckout = s => s === "arrived" || s === "shipped"; // 可結單(顯示賣貨便按鈕)
  const isDone      = s => s === "shipped" || s === "archived"; // 已完成:已寄出 / 已封存
  const isActive    = s => !isDone(s) && s !== "cancelled";     // 進行中:其他

  const filtered = orders.filter(o => {
    if (filter === "active") return isActive(o.status);
    if (filter === "done")   return isDone(o.status);
    return false;
  });

  const activeCount = orders.filter(o => isActive(o.status)).length;
  const doneCount = orders.filter(o => isDone(o.status)).length;

  return(
    <div style={{padding:"16px 16px 100px",display:"flex",flexDirection:"column",gap:14}}>
      {/* 兩個 tab */}
      <div style={{display:"flex",background:C.bgDeep,borderRadius:12,padding:4,gap:0}}>
        <button onClick={()=>setFilter("active")}
          style={{flex:1,padding:"10px 12px",borderRadius:9,border:"none",fontSize:13,fontWeight:filter==="active"?600:400,cursor:"pointer",background:filter==="active"?"#fff":"transparent",color:filter==="active"?C.text:C.muted,boxShadow:filter==="active"?"0 2px 6px rgba(0,0,0,.06)":"none",transition:"all .15s"}}>
          🚚 進行中 <span style={{fontSize:11,opacity:.7,marginLeft:4}}>({activeCount})</span>
        </button>
        <button onClick={()=>setFilter("done")}
          style={{flex:1,padding:"10px 12px",borderRadius:9,border:"none",fontSize:13,fontWeight:filter==="done"?600:400,cursor:"pointer",background:filter==="done"?"#fff":"transparent",color:filter==="done"?C.text:C.muted,boxShadow:filter==="done"?"0 2px 6px rgba(0,0,0,.06)":"none",transition:"all .15s"}}>
          ✓ 已完成 <span style={{fontSize:11,opacity:.7,marginLeft:4}}>({doneCount})</span>
        </button>
      </div>

      {!filtered.length
        ?<Card style={{padding:"40px 20px",textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:8}}>{filter==="active"?"📦":"✓"}</div>
          <div style={{fontSize:13,color:C.faint}}>{filter==="active"?"沒有進行中的訂單":"沒有已完成的訂單"}</div>
        </Card>
        :filtered.map((o,i)=>{
          const createdDate=o.created_at?new Date(o.created_at).toLocaleDateString("zh-TW",{month:"numeric",day:"numeric"}):(o.createdAt||"");
          const itemsTotal=(o.items||[]).reduce((s,it)=>s+(Number(it.price)||0)*(Number(it.qty)||1),0);
          const shippingFee=Number(o.shipping_fee||o.shippingFee||0);
          const grandTotal=itemsTotal+shippingFee;
          return(
            <Card key={o.id} className="fadeUp" style={{animationDelay:`${i*.04}s`,padding:0,overflow:"hidden"}}>
              {/* 訂單頭部 */}
              <div style={{padding:"14px 18px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.borderLight}`}}>
                <div>
                  <div style={{fontSize:11,color:C.faint,marginBottom:2}}>#{o.no}</div>
                  <div style={{fontSize:13,fontWeight:500,color:C.text}}>📅 {createdDate}</div>
                </div>
                <StatusPill status={o.status}/>
              </div>

              {/* 條列式品項明細 */}
              <div style={{padding:"14px 18px"}}>
                <div style={{fontSize:10,color:C.faint,letterSpacing:1,marginBottom:10,fontWeight:600}}>商品明細</div>
                {(o.items||[]).map((it,idx)=>(
                  <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:idx<(o.items.length-1)?`0.5px dashed ${C.borderLight}`:"none"}}>
                    {it.image&&(it.image.startsWith("data:")||it.image.startsWith("http"))?(
                      <img src={it.image} alt="" style={{width:42,height:42,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                    ):(
                      <div style={{width:42,height:42,borderRadius:8,background:C.bgDeep,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🛒</div>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,color:C.text,fontWeight:500,lineHeight:1.3}}>{it.name}</div>
                      {it.note&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{it.note}</div>}
                      <div style={{fontSize:11,color:C.faint,marginTop:3}}>× {it.qty}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{fmtMoney((it.price||0)*(it.qty||1))}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 金額明細 */}
              <div style={{padding:"12px 18px",background:C.bgDeep,borderTop:`1px dashed ${C.borderLight}`}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted,padding:"3px 0"}}>
                  <span>商品小計</span><span>{fmtMoney(itemsTotal)}</span>
                </div>
                {shippingFee>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted,padding:"3px 0"}}>
                    <span>運費</span><span>{fmtMoney(shippingFee)}</span>
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:600,color:C.text,paddingTop:8,marginTop:6,borderTop:`1px solid ${C.borderLight}`}}>
                  <span>TOTAL</span>
                  <span style={{color:C.accent,fontSize:18,fontWeight:700}}>{fmtMoney(grandTotal)}</span>
                </div>
              </div>

              {/* 賣貨便結單按鈕 (已到台/已寄出 才出現) */}
              {canCheckout(o.status) && shopeeUrl && (
                <a href={shopeeUrl} target="_blank" rel="noopener noreferrer"
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"14px",background:C.text,color:"#fff",textDecoration:"none",fontSize:14,fontWeight:600,letterSpacing:.5}}>
                  下一步至賣貨便結單
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>
                </a>
              )}
            </Card>
          );
        })
      }
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
function MainApp({lineUser,data,setData}){
  const [tab,setTab]=useState("catalog");
  const [cart,setCart]=useState([]);
  const [toast,setToast]=useState(null);
  const [member,setMember]=useState(null); // null=未載入, {}=載完但沒資料
  const [memberLoaded,setMemberLoaded]=useState(false);
  const [showCart,setShowCart]=useState(false);
  const [shopeeUrl,setShopeeUrl]=useState("");
  const [autoCancelHours,setAutoCancelHours]=useState(36);

  // 個資完整性檢查:四個必填欄位都要有值
  const isProfileComplete=!!(member?.community_name?.trim()&&member?.ig_threads?.trim()&&member?.recipient_name?.trim()&&member?.phone?.trim());

  // 抽出載入函式,可重用
  const reloadData = useCallback(async ()=>{
    try {
      const [ordersRes, productsRes, inStockRes, wishlistRes, annRes] = await Promise.all([
        supabase.from("orders").select("*").eq("customer_line_id",lineUser.userId).order("created_at",{ascending:false}),
        supabase.from("products").select("*").order("created_at",{ascending:false}),
        supabase.from("in_stock").select("*").order("created_at",{ascending:false}),
        supabase.from("wishlist").select("*").eq("customer_line_id",lineUser.userId).order("created_at",{ascending:false}),
        supabase.from("announcements").select("*").order("created_at",{ascending:false}),
      ]);
      setData(d=>({
        ...d,
        orders: ordersRes.data || d.orders,
        products: productsRes.data || d.products,
        inStock: inStockRes.data || d.inStock,
        wishlist: wishlistRes.data || d.wishlist,
        announcements: annRes.data || d.announcements,
      }));
      console.log(`📊 客人端已載入: 訂單 ${(ordersRes.data||[]).length}, 商品 ${(productsRes.data||[]).length}, 許願 ${(wishlistRes.data||[]).length}`);

      // 檢查逾期未匯款訂單 (使用業者設定的時數,狀態仍在 pending_review 且無匯款資訊)
      const now = Date.now();
      const AUTO_CANCEL_MS = autoCancelHours * 60 * 60 * 1000;
      const expiredOrders = (ordersRes.data || []).filter(o =>
        o.status === "pending_review" &&
        !o.deposit_amount &&
        !o.deposit_last5 &&
        o.created_at &&
        (now - new Date(o.created_at).getTime()) > AUTO_CANCEL_MS
      );
      if (expiredOrders.length > 0) {
        console.log(`⏰ 自動取消 ${expiredOrders.length} 筆逾期訂單`);
        for (const o of expiredOrders) {
          await supabase.from("orders")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", o.id);
        }
      }
    } catch (e) { console.error("Reload 失敗:", e); }
  }, [lineUser.userId, setData, autoCancelHours]);

  useEffect(()=>{
    injectStyles();
    reloadData(); // 初次載入
    supabase.from("members").select("*").eq("line_user_id",lineUser.userId).single().then(({data:m})=>{setMember(m||{});setMemberLoaded(true);});
    // 載入賣貨便連結+取消時數
    Promise.all([
      supabase.from("settings").select("*").eq("key","shopee_ship_url").maybeSingle(),
      supabase.from("settings").select("*").eq("key","auto_cancel_hours").maybeSingle(),
    ]).then(([s1, s2]) => {
      if(s1.data?.value) setShopeeUrl(s1.data.value);
      if(s2.data?.value) setAutoCancelHours(Number(s2.data.value) || 36);
    }).catch(()=>{});

    const channel=supabase.channel("realtime-all")
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"orders",filter:`customer_line_id=eq.${lineUser.userId}`},
        (payload)=>{
          setData(d=>({...d,orders:d.orders.map(o=>o.id===payload.new.id?{...o,...payload.new}:o)}));
          if(payload.new.status==="cancelled"&&payload.old?.status==="pending_review"){
            setToast("❌ 您的訂單已被拒絕並取消");setTab("orders");
          }
        }
      )
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"orders",filter:`customer_line_id=eq.${lineUser.userId}`},
        (payload)=>{setData(d=>({...d,orders:[payload.new,...d.orders.filter(o=>o.id!==payload.new.id)]}));}
      )
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"orders"},
        (payload)=>{setData(d=>({...d,orders:d.orders.filter(o=>o.id!==payload.old.id)}));setToast("🗑️ 一筆訂單已被刪除");}
      )
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"products"},
        (payload)=>{setData(d=>({...d,products:[...d.products,payload.new]}));}
      )
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"products"},
        (payload)=>{setData(d=>({...d,products:d.products.map(p=>p.id===payload.new.id?{...p,...payload.new}:p)}));}
      )
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"products"},
        (payload)=>{setData(d=>({...d,products:d.products.filter(p=>p.id!==payload.old.id)}));}
      )
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"in_stock"},
        (payload)=>{setData(d=>({...d,inStock:[...d.inStock,payload.new]}));}
      )
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"in_stock"},
        (payload)=>{setData(d=>({...d,inStock:d.inStock.map(p=>p.id===payload.new.id?{...p,...payload.new}:p)}));}
      )
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"in_stock"},
        (payload)=>{setData(d=>({...d,inStock:d.inStock.filter(p=>p.id!==payload.old.id)}));}
      )
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"wishlist"},
        (payload)=>{setData(d=>({...d,wishlist:d.wishlist.map(w=>w.id===payload.new.id?{...w,...payload.new}:w)}));}
      )
      .on("postgres_changes",{event:"DELETE",schema:"public",table:"wishlist"},
        (payload)=>{setData(d=>({...d,wishlist:d.wishlist.filter(w=>w.id!==payload.old.id)}));}
      )
      .subscribe((status)=>{
        console.log("📡 客人端 Realtime status:", status);
      });

    // 30 秒輪詢備援
    const heartbeat = setInterval(() => { reloadData(); }, 30000);

    return()=>{ supabase.removeChannel(channel); clearInterval(heartbeat); };
  },[reloadData,lineUser.userId,setData]);

  // 切換分頁時自動拉最新資料
  useEffect(()=>{
    if (["catalog","orders","shipments","wishlist"].includes(tab)) {
      reloadData();
    }
  }, [tab, reloadData]);

  const myOrders=data.orders.filter(o=>o.customer_line_id===lineUser.userId||o.customerId==="me");
  const myWishes=data.wishlist.filter(w=>w.customer_line_id===lineUser.userId||w.customerId==="me");

  const addToCart=item=>{
    const safe={...item,name:sanitize(item.name,100),price:safePrice(item.price)};
    setCart(p=>{const ex=p.find(x=>x.id===safe.id);return ex?p.map(x=>x.id===safe.id?{...x,qty:Math.min(x.qty+1,99)}:x):[...p,{...safe,qty:1,note:""}];});
    setToast("已加入購物車 🛍");
  };
  const updateCartQty=(id,delta)=>setCart(p=>p.map(c=>c.id===id?{...c,qty:Math.max(1,Math.min(99,c.qty+delta))}:c));
  const removeFromCart=id=>setCart(p=>p.filter(c=>c.id!==id));

  const submitOrder=async(payInfo={})=>{
    if(!cart.length)return;
    const no=secureOrderNo();
    const items=cart.map(c=>({
      name:sanitize(c.name,100),
      qty:safeQty(c.qty),
      price:safePrice(c.price),
      note:sanitize(c.note||"",200),
      image:c.image||"",
      payment_type: c.payment_type || "full",
      deposit_amount: Number(c.deposit_amount) || 0,
    }));
    const total=items.reduce((s,c)=>s+c.price*c.qty,0);
    const orderData={
      id:secureUid(),no,
      customer_line_id:lineUser.userId,
      customer_name:sanitize(lineUser.name,50)||"匿名",
      status:"pending_review",
      items,total,
      deposit_amount: Number(payInfo.payAmount) || 0,
      deposit_last5: sanitize(payInfo.payLast5 || "", 5),
      deposit_bank: sanitize(payInfo.payBank || "", 100),
      deposit_paid: (Number(payInfo.payAmount) > 0),
      created_at:new Date().toISOString(),
    };
    try{
      const{data:saved,error}=await supabase.from("orders").insert([orderData]).select().single();
      if(error)throw error;
      setData(d=>({...d,orders:[saved,...d.orders]}));
      setCart([]);setShowCart(false);setTab("orders");
      setToast(payInfo.payAmount>0?`訂單已送出 · 已記錄匯款 NT$${payInfo.payAmount} 🌸`:"訂單已送出 🌸");
    }catch(e){
      console.error(e);
      // 如果 Supabase 還沒有 deposit_* 欄位,fallback 不帶這些欄位重試
      if(e.message&&/deposit_/.test(e.message)){
        const{deposit_amount,deposit_last5,deposit_bank,deposit_paid,...rest}=orderData;
        const{data:saved2,error:e2}=await supabase.from("orders").insert([rest]).select().single();
        if(!e2){
          setData(d=>({...d,orders:[saved2,...d.orders]}));
          setCart([]);setShowCart(false);setTab("orders");
          setToast("訂單已送出(匯款資訊未存,請聯繫業者)");
          alert("⚠️ 訂單已建立,但匯款資訊未儲存。請聯繫業者並提供匯款金額與末 5 碼。");
          return;
        }
      }
      alert("下單失敗:"+(e.message||"請稍後再試"));
    }
  };

  const addWish=async(name,note,imgUrl,link)=>{
    const n=sanitize(name,100);if(!n)return;
    const wishData={id:secureUid(),customer_line_id:lineUser.userId,customer_name:sanitize(lineUser.name,50)||"匿名",name:n,note:sanitize(note,200),img_url:sanitize(imgUrl,500),link:sanitize(link,500),status:"searching",created_at:new Date().toISOString()};
    try{
      const{data:saved,error}=await supabase.from("wishlist").insert([wishData]).select().single();
      if(error)throw error;
      setData(d=>({...d,wishlist:[saved,...d.wishlist]}));
    }catch{setData(d=>({...d,wishlist:[wishData,...d.wishlist]}));}
    setToast("許願已送出 🌸");
  };

  const deleteWish=async(id)=>{
    try{
      const{error}=await supabase.from("wishlist").delete().eq("id",id);
      if(error)throw error;
      setData(d=>({...d,wishlist:d.wishlist.filter(w=>w.id!==id)}));
      setToast("已刪除許願");
    }catch{setToast("刪除失敗");}
  };

  // 頁面標題
  const PAGE_TITLE={
    catalog:"商品下單",profile:`Hi, ${lineUser.name}`,
    wishlist:"許願清單",orders:"我的訂單",shipments:"出貨紀錄",
  };

  // member 還沒載入完 → 顯示載入畫面
  if(!memberLoaded){
    return(
      <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
        <div style={{width:24,height:24,borderRadius:"50%",border:`2px solid ${C.faint}`,borderTopColor:C.accent,animation:"spin 1s linear infinite"}}/>
        <div style={{fontSize:12,color:C.faint,letterSpacing:.5}}>載入會員資料</div>
      </div>
    );
  }

  // 個資未填齊 → 強制顯示填寫頁(沒有 BottomNav、沒有購物車、沒有登出以外的功能)
  if(!isProfileComplete){
    return(
      <div style={{minHeight:"100vh",background:C.bg,maxWidth:480,margin:"0 auto",paddingBottom:60}}>
        <div style={{padding:"20px 20px 0",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.bg,zIndex:50,paddingBottom:12,borderBottom:`1px solid ${C.borderLight}`}}>
          <div style={{fontSize:18,fontWeight:600,color:C.text,letterSpacing:.3}}>建立會員資料</div>
          <button onClick={()=>{if(typeof liff!=="undefined")liff.logout();window.location.reload();}} style={{background:"none",border:"none",fontSize:12,color:C.faint,cursor:"pointer"}}>登出</button>
        </div>
        <ProfileTab member={member} setMember={setMember} lineUser={lineUser} setToast={setToast} forced={true}/>
        {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
      </div>
    );
  }

  return(
    <div style={{minHeight:"100vh",background:C.bg,maxWidth:480,margin:"0 auto",paddingBottom:60}}>
      {/* Top header */}
      <div style={{padding:"20px 20px 0",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.bg,zIndex:50,paddingBottom:12,borderBottom:`1px solid ${C.borderLight}`}}>
        <div style={{fontSize:18,fontWeight:600,color:C.text,letterSpacing:.3}}>{PAGE_TITLE[tab]||""}</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {tab==="catalog"&&(
            <button onClick={()=>setShowCart(true)} style={{position:"relative",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",width:36,height:36}}>
              <Icon name="catalog" size={22} color={C.textMid}/>
              {cart.length>0&&<span style={{position:"absolute",top:0,right:0,background:C.accent,color:"#fff",fontSize:8,width:14,height:14,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{cart.reduce((s,c)=>s+c.qty,0)}</span>}
            </button>
          )}
          <button onClick={()=>{if(typeof liff!=="undefined")liff.logout();window.location.reload();}} style={{background:"none",border:"none",fontSize:12,color:C.faint,cursor:"pointer"}}>登出</button>
        </div>
      </div>

      {/* Content */}
      {tab==="profile"&&<ProfileTab member={member} setMember={setMember} lineUser={lineUser} setToast={setToast}/>}
      {tab==="catalog"&&<CatalogTab products={data.products} inStock={data.inStock} rate={data.rate} cart={cart} onAdd={addToCart} showCart={showCart} setShowCart={setShowCart} updateCartQty={updateCartQty} removeFromCart={removeFromCart} submitOrder={submitOrder} autoCancelHours={autoCancelHours}/>}
      {tab==="wishlist"&&<WishlistTab wishes={myWishes} onAddWish={addWish} onDeleteWish={deleteWish} onAddToCart={addToCart} setTab={setTab}/>}
      {tab==="orders"&&<OrdersTab orders={myOrders}/>}
      {tab==="shipments"&&<ShipmentsTab orders={myOrders} shopeeUrl={shopeeUrl}/>}

      {/* Bottom Nav */}
      <BottomNav tab={tab} setTab={setTab} cartCount={cart.reduce((s,c)=>s+c.qty,0)}/>

      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────
export default function App(){
  const [lineUser,setLineUser]=useState(null);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{injectStyles();},[]);

  const handleLogin=async(user)=>{
    setLineUser(user);
    const[{data:products},{data:inStockData},{data:orders},{data:wishlist}]=await Promise.all([
      supabase.from("products").select("*").eq("status","on"),
      supabase.from("in_stock").select("*").eq("status","on"),
      supabase.from("orders").select("*").eq("customer_line_id",user.userId).order("created_at",{ascending:false}),
      supabase.from("wishlist").select("*").eq("customer_line_id",user.userId),
    ]);
    setData({rate:1,products:products||INIT_DATA.products,inStock:inStockData||INIT_DATA.inStock,orders:orders||INIT_DATA.orders,wishlist:wishlist||INIT_DATA.wishlist,announcements:[]});
    setLoading(false);
  };

  if(!lineUser)return<LineLogin onSuccess={handleLogin}/>;
  if(loading||!data)return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
      <div style={{width:24,height:24,borderRadius:"50%",border:`2px solid ${C.faint}`,borderTopColor:C.accent,animation:"spin 1s linear infinite"}}/>
      <div style={{fontSize:12,color:C.faint,letterSpacing:.5}}>載入中</div>
    </div>
  );
  return<MainApp lineUser={lineUser} data={data} setData={setData}/>;
}
