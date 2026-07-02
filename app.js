// ============================================================
// FIREBASE CONFIG — your project (milkmarks-e83fa)
// Still need to fill in apiKey + appId below (see chat for how).
// Firebase Console → milkmarks-e83fa → ⚙️ Project settings → General
// → "Your apps" → Web app → SDK setup and configuration.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, addDoc, setDoc,
  deleteDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "milkmarks-e83fa.firebaseapp.com",
  projectId: "milkmarks-e83fa",
  storageBucket: "milkmarks-e83fa.firebasestorage.app",
  messagingSenderId: "37336894457",
  appId: "PASTE_YOUR_APP_ID_HERE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const EMAIL_DOMAIN = "@milkmarks.app";
const toUsernameLower = (u) => u.trim().toLowerCase();
const toEmail = (u) => `${toUsernameLower(u)}${EMAIL_DOMAIN}`;

let currentUser = null;      // firebase auth user
let currentProfile = null;   // { username, isAdmin }
let allMilks = [];           // [{id, name, brand, imageUrl, reviews:[...]}]
let activeMilkId = null;
let activeReviewIndex = 0;

/* ---------------- helpers ---------------- */
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return document.querySelectorAll(sel); }
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  show(t);
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=>hide(t), 2600);
}

function bar(value, max=10){
  const filled = "█".repeat(value);
  const empty = "░".repeat(max - value);
  return `<span class="filled">${filled}</span><span class="empty">${empty}</span> ${value}`;
}

function starsStr(n){
  n = Math.max(0, Math.min(5, Math.round(n)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function gradeColor(grade){
  if(!grade) return "var(--ink)";
  const l = grade[0];
  if(l === "A") return "var(--green-deep)";
  if(l === "B") return "var(--wood-dark)";
  if(l === "C") return "var(--gold)";
  return "var(--red)";
}

function fmtDate(d){
  if(!d) return "—";
  try{ return new Date(d + "T00:00:00").toLocaleDateString(undefined,{year:"numeric",month:"2-digit",day:"2-digit"}); }
  catch(e){ return d; }
}

/* ---------------- navigation ---------------- */
function navigate(view){
  $all(".content-view").forEach(hide);
  $all(".ledger-sidebar .tag-label")[0]; // no-op, sidebar always visible
  if(view === "home"){ show($("#view-empty")); }
  if(view === "add-milk"){ show($("#view-add-milk")); }
  if(view === "admin" && currentProfile?.isAdmin){ loadAdminPanel(); show($("#view-admin")); }
  if(view === "milk"){ show($("#view-milk")); }
  if(view === "add-review"){ show($("#view-add-review")); }
}
$all("[data-nav]").forEach(el=>{
  el.addEventListener("click", ()=> navigate(el.dataset.nav));
});

/* ---------------- AUTH: tabs ---------------- */
$all(".tab-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    $all(".tab-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    if(btn.dataset.tab === "login"){
      show($("#form-login")); hide($("#form-signup"));
    } else {
      show($("#form-signup")); hide($("#form-login"));
    }
  });
});

/* ---------------- AUTH: signup ---------------- */
$("#form-signup").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const errEl = $("#signup-error");
  errEl.textContent = "";
  const username = $("#signup-username").value.trim();
  const password = $("#signup-password").value;
  const usernameLower = toUsernameLower(username);

  if(username.length < 3){ errEl.textContent = "Username must be at least 3 characters."; return; }
  if(password.length < 6){ errEl.textContent = "Password must be at least 6 characters."; return; }

  if(usernameLower === "dimitry" && password !== "301718"){
    errEl.textContent = "This username is reserved for the Archive Master account.";
    return;
  }

  try{
    // check if username already taken
    const q = query(collection(db,"users"), where("usernameLower","==",usernameLower));
    const existing = await getDocs(q);
    if(!existing.empty){
      errEl.textContent = "That username is already filed. Try signing in instead.";
      return;
    }
    const cred = await createUserWithEmailAndPassword(auth, toEmail(username), password);
    await setDoc(doc(db,"users",cred.user.uid), {
      username, usernameLower,
      isAdmin: usernameLower === "dimitry",
      createdAt: serverTimestamp()
    });
    toast("Account filed. Welcome to the archive!");
  }catch(err){
    errEl.textContent = friendlyAuthError(err);
  }
});

/* ---------------- AUTH: login ---------------- */
$("#form-login").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const errEl = $("#login-error");
  errEl.textContent = "";
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  try{
    await signInWithEmailAndPassword(auth, toEmail(username), password);
  }catch(err){
    errEl.textContent = friendlyAuthError(err);
  }
});

function friendlyAuthError(err){
  const code = err.code || "";
  if(code.includes("user-not-found") || code.includes("invalid-credential") || code.includes("wrong-password")){
    return "Username or password doesn't match our ledger.";
  }
  if(code.includes("email-already-in-use")){ return "That username is already filed."; }
  if(code.includes("weak-password")){ return "Password must be at least 6 characters."; }
  return "Something went wrong: " + code.replace("auth/","");
}

$("#btn-logout").addEventListener("click", ()=> signOut(auth));

/* ---------------- AUTH STATE ---------------- */
onAuthStateChanged(auth, async (user)=>{
  currentUser = user;
  if(user){
    let snap = await getDoc(doc(db,"users",user.uid));
    if(!snap.exists()){
      // fallback profile doc, shouldn't normally happen
      await setDoc(doc(db,"users",user.uid), {
        username: user.email.split("@")[0], usernameLower: user.email.split("@")[0],
        isAdmin: false, createdAt: serverTimestamp()
      });
      snap = await getDoc(doc(db,"users",user.uid));
    }
    currentProfile = snap.data();
    $("#current-username").textContent = currentProfile.username;
    if(currentProfile.isAdmin){ $all(".admin-only").forEach(show); }
    else { $all(".admin-only").forEach(hide); }

    hide($("#screen-auth"));
    show($("#screen-app"));
    await loadMilks();
    navigate("home");
  } else {
    currentProfile = null;
    show($("#screen-auth"));
    hide($("#screen-app"));
  }
});

/* ---------------- MILKS: load + list + search ---------------- */
async function loadMilks(){
  const milksSnap = await getDocs(query(collection(db,"milks"), orderBy("name")));
  const milks = [];
  for(const mDoc of milksSnap.docs){
    const revSnap = await getDocs(query(collection(db,"milks",mDoc.id,"reviews"), orderBy("date","desc")));
    const reviews = revSnap.docs.map(r=>({id:r.id, ...r.data()}));
    milks.push({ id: mDoc.id, ...mDoc.data(), reviews });
  }
  allMilks = milks;
  renderMilkList();
}

function renderMilkList(){
  const term = $("#search-input").value.trim().toLowerCase();
  const list = $("#milk-list");
  list.innerHTML = "";
  const filtered = allMilks.filter(m=>{
    if(!term) return true;
    const hay = [m.name, m.brand, ...(m.reviews||[]).map(r=>r.source||"")].join(" ").toLowerCase();
    return hay.includes(term);
  });
  if(filtered.length === 0){
    list.innerHTML = `<div class="milk-list-empty">No milks filed yet${term ? " matching that search" : ""}.</div>`;
    return;
  }
  filtered.forEach(m=>{
    const latest = m.reviews && m.reviews[0];
    const avgStars = m.reviews && m.reviews.length
      ? m.reviews.reduce((s,r)=>s+(r.stars||0),0)/m.reviews.length : null;
    const item = document.createElement("button");
    item.className = "milk-list-item" + (m.id === activeMilkId ? " active" : "");
    item.innerHTML = `<span>${escapeHtml(m.name)}</span>
      <span class="grade-chip" style="color:${gradeColor(latest?.grade)}">${latest ? latest.grade : "—"}${avgStars!==null ? " "+starsStr(avgStars).slice(0,1) : ""}</span>`;
    item.addEventListener("click", ()=> selectMilk(m.id));
    list.appendChild(item);
  });
}
$("#search-input").addEventListener("input", renderMilkList);

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- ADD MILK ---------------- */
$("#form-add-milk").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const errEl = $("#add-milk-error");
  errEl.textContent = "";
  const name = $("#milk-name").value.trim();
  const brand = $("#milk-brand").value.trim();
  const imageUrl = $("#milk-image").value.trim();
  if(!name || !brand){ errEl.textContent = "Name and brand are required."; return; }
  try{
    const docRef = await addDoc(collection(db,"milks"), {
      name, brand, imageUrl,
      createdBy: currentUser.uid, createdByUsername: currentProfile.username,
      createdAt: serverTimestamp()
    });
    $("#form-add-milk").reset();
    toast("Milk filed! Now add your inspection review.");
    await loadMilks();
    openAddReview(docRef.id, name);
  }catch(err){
    errEl.textContent = "Couldn't file this milk: " + err.message;
  }
});

/* ---------------- MILK DETAIL ---------------- */
function selectMilk(milkId){
  activeMilkId = milkId;
  activeReviewIndex = 0;
  renderMilkList();
  renderMilkDetail();
  navigate("milk");
}

function renderMilkDetail(){
  const milk = allMilks.find(m=>m.id === activeMilkId);
  const container = $("#view-milk");
  if(!milk){ container.innerHTML = ""; return; }
  const reviews = milk.reviews || [];

  if(reviews.length === 0){
    container.innerHTML = `
      <div class="ledger-sheet">
        <div class="pin"></div>
        <div class="milk-header-sheet">
          ${milk.imageUrl ? `<img class="milk-photo" src="${escapeHtml(milk.imageUrl)}" alt="${escapeHtml(milk.name)}">` : `<div class="milk-photo" style="display:flex;align-items:center;justify-content:center;font-size:3rem;">🥛</div>`}
          <div>
            <h2 class="milk-title">${escapeHtml(milk.name)}</h2>
            <p class="milk-sub">${escapeHtml(milk.brand)} · filed by ${escapeHtml(milk.createdByUsername||"unknown")}</p>
            <p class="prose">No inspection sheets filed for this milk yet. Be the first to leave a review.</p>
            <button class="btn-stamp" id="btn-first-review">Leave a Review</button>
          </div>
        </div>
      </div>`;
    $("#btn-first-review").addEventListener("click", ()=> openAddReview(milk.id, milk.name));
    return;
  }

  const rev = reviews[activeReviewIndex] || reviews[0];
  const pros = (rev.pros||[]);
  const cons = (rev.cons||[]);

  container.innerHTML = `
    <div class="ledger-sheet">
      <div class="pin"></div>
      <div class="milk-header-sheet" style="position:relative;">
        <div class="grade-stamp" style="border-color:${gradeColor(rev.grade)}; color:${gradeColor(rev.grade)};">
          <span class="g-label">GRADE</span>${escapeHtml(rev.grade||"?")}
        </div>
        ${milk.imageUrl ? `<img class="milk-photo" src="${escapeHtml(milk.imageUrl)}" alt="${escapeHtml(milk.name)}">` : `<div class="milk-photo" style="display:flex;align-items:center;justify-content:center;font-size:3rem;">🥛</div>`}
        <div>
          <h2 class="milk-title">${escapeHtml(milk.name)}</h2>
          <p class="milk-sub">${escapeHtml(milk.brand)}</p>
          <div class="stars-row">${starsStr(rev.stars)}</div>
          <div class="meta-table">
            <div><b>Date:</b> ${fmtDate(rev.date)}</div>
            <div><b>Price:</b> ${rev.price ? "$"+Number(rev.price).toFixed(2) : "—"}</div>
            <div><b>Size:</b> ${escapeHtml(rev.size || "—")}</div>
            <div><b>Source:</b> ${escapeHtml(rev.source || "—")}</div>
          </div>
        </div>
      </div>

      ${reviews.length > 1 ? `<div class="review-tabs">${reviews.map((r,i)=>`
        <button class="review-tab-btn ${i===activeReviewIndex?"active":""}" data-idx="${i}">
          #${i+1} · ${fmtDate(r.date)} · ${escapeHtml(r.username)}
        </button>`).join("")}</div>` : ""}

      <div class="review-sheet-inner">
        <div class="rating-block">
          <h4>Flavor</h4>
          <div class="bar-row">${bar(rev.flavor)}</div>
          ${rev.flavorNote ? `<p class="bar-note">${escapeHtml(rev.flavorNote)}</p>` : ""}
        </div>
        <div class="rating-block">
          <h4>Creaminess</h4>
          <div class="bar-row">${bar(rev.creaminess)}</div>
          ${rev.creaminessNote ? `<p class="bar-note">${escapeHtml(rev.creaminessNote)}</p>` : ""}
        </div>
        <div class="rating-block">
          <h4>Packaging</h4>
          <div class="bar-row">${bar(rev.packaging)}</div>
          ${rev.packagingNote ? `<p class="bar-note">${escapeHtml(rev.packagingNote)}</p>` : ""}
        </div>
        <div class="rating-block">
          <h4>Cost</h4>
          <div class="bar-row">${bar(rev.cost)}</div>
          ${rev.costNote ? `<p class="bar-note">${escapeHtml(rev.costNote)}</p>` : ""}
        </div>

        ${(pros.length || cons.length) ? `<div class="pros-cons">
          ${pros.map(p=>`<div class="${p.startsWith('~')?'pc-neutral':'pc-yes'}">${p.startsWith('~')?'~':'✓'} ${escapeHtml(p.replace(/^~/,'').trim())}</div>`).join("")}
          ${cons.map(c=>`<div class="${c.startsWith('~')?'pc-neutral':'pc-no'}">${c.startsWith('~')?'~':'✕'} ${escapeHtml(c.replace(/^~/,'').trim())}</div>`).join("")}
        </div>` : ""}

        ${(rev.farmNotes || rev.cowProfile) ? `<div class="notes-grid">
          ${rev.farmNotes ? `<div class="note-card"><h5>Farm Notes</h5>${escapeHtml(rev.farmNotes)}</div>` : ""}
          ${rev.cowProfile ? `<div class="note-card"><h5>Cow Profile</h5>${escapeHtml(rev.cowProfile)}</div>` : ""}
        </div>` : ""}

        ${rev.finalWord ? `<div class="final-word"><strong>Final Word:</strong> ${escapeHtml(rev.finalWord)}</div>` : ""}

        <div class="filed-stamp">FILED ★</div>
        <p class="review-byline">Inspected by ${escapeHtml(rev.username)} on ${fmtDate(rev.date)}
          ${(currentProfile?.isAdmin || rev.userId === currentUser.uid) ? ` · <button id="btn-delete-review" style="background:none;border:none;color:var(--red);text-decoration:underline;cursor:pointer;font-family:inherit;">delete this review</button>` : ""}
        </p>
      </div>

      <div class="reveal-actions">
        <button class="btn-stamp" id="btn-new-review">Leave Another Review</button>
      </div>
    </div>`;

  $all(".review-tab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{ activeReviewIndex = Number(btn.dataset.idx); renderMilkDetail(); });
  });
  $("#btn-new-review").addEventListener("click", ()=> openAddReview(milk.id, milk.name));
  const delBtn = $("#btn-delete-review");
  if(delBtn){
    delBtn.addEventListener("click", async ()=>{
      if(!confirm("Delete this review permanently?")) return;
      await deleteDoc(doc(db,"milks",milk.id,"reviews",rev.id));
      toast("Review removed from the ledger.");
      await loadMilks();
      selectMilk(milk.id);
    });
  }
}

/* ---------------- ADD REVIEW ---------------- */
const rangeIds = ["flavor","creaminess","packaging","cost"];
rangeIds.forEach(id=>{
  const input = $("#rev-"+id);
  input.addEventListener("input", ()=>{ $("#out-"+id).textContent = input.value; });
});

let addReviewMilkId = null;
function openAddReview(milkId, milkName){
  addReviewMilkId = milkId;
  $("#review-milk-name").textContent = milkName;
  $("#form-add-review").reset();
  rangeIds.forEach(id=> $("#out-"+id).textContent = $("#rev-"+id).value);
  $("#rev-date").value = new Date().toISOString().slice(0,10);
  navigate("add-review");
}

$("#form-add-review").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const errEl = $("#add-review-error");
  errEl.textContent = "";
  try{
    const pros = $("#rev-pros").value.split("\n").map(s=>s.trim()).filter(Boolean);
    const cons = $("#rev-cons").value.split("\n").map(s=>s.trim()).filter(Boolean);
    const payload = {
      userId: currentUser.uid,
      username: currentProfile.username,
      date: $("#rev-date").value,
      grade: $("#rev-grade").value,
      stars: Number($("#rev-stars").value),
      price: $("#rev-price").value ? Number($("#rev-price").value) : null,
      size: $("#rev-size").value.trim(),
      source: $("#rev-source").value.trim(),
      flavor: Number($("#rev-flavor").value),
      flavorNote: $("#rev-flavor-note").value.trim(),
      creaminess: Number($("#rev-creaminess").value),
      creaminessNote: $("#rev-creaminess-note").value.trim(),
      packaging: Number($("#rev-packaging").value),
      packagingNote: $("#rev-packaging-note").value.trim(),
      cost: Number($("#rev-cost").value),
      costNote: $("#rev-cost-note").value.trim(),
      pros, cons,
      farmNotes: $("#rev-farm-notes").value.trim(),
      cowProfile: $("#rev-cow-profile").value.trim(),
      finalWord: $("#rev-final-word").value.trim(),
      createdAt: serverTimestamp()
    };
    await addDoc(collection(db,"milks",addReviewMilkId,"reviews"), payload);
    toast("Review stamped and filed!");
    await loadMilks();
    selectMilk(addReviewMilkId);
  }catch(err){
    errEl.textContent = "Couldn't file this review: " + err.message;
  }
});

/* ---------------- ADMIN PANEL ---------------- */
async function loadAdminPanel(){
  hide($("#admin-user-detail"));
  const usersSnap = await getDocs(query(collection(db,"users"), orderBy("usernameLower")));
  const list = $("#admin-user-list");
  list.innerHTML = "";
  usersSnap.forEach(u=>{
    const data = u.data();
    const row = document.createElement("div");
    row.className = "admin-user-row";
    row.innerHTML = `<span>${escapeHtml(data.username)}${data.isAdmin ? " ⭐ (master)" : ""}</span>
      <span>
        <button data-uid="${u.id}" data-action="view">View Reviews</button>
        ${!data.isAdmin ? `<button data-uid="${u.id}" data-name="${escapeHtml(data.username)}" class="danger" data-action="delete">Delete</button>` : ""}
      </span>`;
    list.appendChild(row);
  });
  list.querySelectorAll("[data-action='view']").forEach(btn=>{
    btn.addEventListener("click", ()=> viewUserReviews(btn.dataset.uid));
  });
  list.querySelectorAll("[data-action='delete']").forEach(btn=>{
    btn.addEventListener("click", ()=> deleteUser(btn.dataset.uid, btn.dataset.name));
  });
}

async function viewUserReviews(uid){
  const userSnap = await getDoc(doc(db,"users",uid));
  const username = userSnap.exists() ? userSnap.data().username : "Unknown";
  $("#admin-detail-name").textContent = `Reviews filed by ${username}`;
  const q = query(collectionGroup(db,"reviews"), where("userId","==",uid));
  const revSnap = await getDocs(q);
  const detailEl = $("#admin-detail-reviews");
  if(revSnap.empty){
    detailEl.innerHTML = `<p class="prose">No reviews filed by this user yet.</p>`;
  } else {
    detailEl.innerHTML = "";
    revSnap.forEach(r=>{
      const d = r.data();
      const milkId = r.ref.parent.parent.id;
      const milk = allMilks.find(m=>m.id === milkId);
      const card = document.createElement("div");
      card.className = "mini-review-card";
      card.innerHTML = `<b>${escapeHtml(milk ? milk.name : "Unknown milk")}</b> — ${d.grade}, ${starsStr(d.stars)} — ${fmtDate(d.date)}
        <br><span style="font-family:var(--font-body);">${escapeHtml(d.finalWord || d.flavorNote || "")}</span>`;
      detailEl.appendChild(card);
    });
  }
  show($("#admin-user-detail"));
}

async function deleteUser(uid, username){
  if(!confirm(`Delete ${username}'s profile and all of their reviews? This cannot be undone.`)) return;
  const q = query(collectionGroup(db,"reviews"), where("userId","==",uid));
  const revSnap = await getDocs(q);
  for(const r of revSnap.docs){
    await deleteDoc(r.ref);
  }
  await deleteDoc(doc(db,"users",uid));
  toast(`${username}'s profile was removed from the archive.`);
  await loadMilks();
  loadAdminPanel();
}
