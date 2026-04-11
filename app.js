(function () {
  const STORAGE_KEY = "clb-site-data-v1";
  const AUTH_SESSION_KEY = "clb-admin-session-v1";

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getExpectedPassword() {
    if (typeof window.CLB_ADMIN_PASSWORD !== "string") return null;
    return window.CLB_ADMIN_PASSWORD;
  }

  function isPasswordConfigured() {
    const p = getExpectedPassword();
    return p !== null && p.length > 0;
  }

  function isEditor() {
    if (!isPasswordConfigured()) return false;
    return sessionStorage.getItem(AUTH_SESSION_KEY) === "1";
  }

  function setEditorSession(on) {
    if (on) sessionStorage.setItem(AUTH_SESSION_KEY, "1");
    else sessionStorage.removeItem(AUTH_SESSION_KEY);
  }

  function sanitizeImgSrc(src) {
    const s = String(src || "").trim();
    if (!s) return "";
    const lower = s.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return "";
    if (lower.startsWith("data:")) {
      if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return s;
      return "";
    }
    return s;
  }

  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  const RESIZE_MAX_SIDE = 960;
  const JPEG_QUALITY = 0.88;

  function fileToDataUrlNoResize(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(file);
    });
  }

  function resizeImageFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w < 1 || h < 1) {
          reject(new Error("dims"));
          return;
        }
        if (w > RESIZE_MAX_SIDE || h > RESIZE_MAX_SIDE) {
          if (w > h) {
            h = Math.round((h * RESIZE_MAX_SIDE) / w);
            w = RESIZE_MAX_SIDE;
          } else {
            w = Math.round((w * RESIZE_MAX_SIDE) / h);
            h = RESIZE_MAX_SIDE;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("ctx"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("load"));
      };
      img.src = url;
    });
  }

  function isLikelyImageFile(file) {
    if (!file) return false;
    const t = (file.type || "").toLowerCase().trim();
    if (/^image\/(jpe?g|png|gif|webp|pjpeg|x-png)$/.test(t)) return true;
    if (t === "image/jpg") return true;
    const n = (file.name || "").toLowerCase();
    return /\.(jpe?g|png|gif|webp|jfif|bmp)$/i.test(n);
  }

  async function imageFileToStoredSrc(file) {
    if (!file) return "";
    if (!isLikelyImageFile(file)) {
      alert(
        "That file doesn’t look like an image. Use JPG, PNG, GIF, or WebP — PDFs, Word docs, and other types won’t display here."
      );
      return "";
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      alert("Image is too large. Please use a file under 8 MB.");
      return "";
    }
    try {
      const dataUrl = await resizeImageFileToDataUrl(file);
      return sanitizeImgSrc(dataUrl);
    } catch (_) {
      try {
        const raw = await fileToDataUrlNoResize(file);
        const out = sanitizeImgSrc(raw);
        if (out) return out;
      } catch (__) {}
      alert("Could not read this file as an image. Try another JPG or PNG.");
      return "";
    }
  }

  let memberPhotoDataUrl = null;
  let galleryPhotoDataUrl = null;
  let editingMemberId = null;

  function normalizeState(parsed) {
    const def = structuredClone(window.CLB_DEFAULT_DATA);
    if (!parsed || typeof parsed !== "object") return def;
    return {
      members: Array.isArray(parsed.members) ? parsed.members : def.members,
      past: Array.isArray(parsed.past) ? parsed.past : def.past,
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : def.upcoming,
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return normalizeState(parsed);
        }
      }
    } catch (_) {}
    return structuredClone(window.CLB_DEFAULT_DATA);
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  let state = loadData();

  const el = {
    teamGrid: document.getElementById("team-grid"),
    pastList: document.getElementById("past-list"),
    upcomingList: document.getElementById("upcoming-list"),
    photoGallery: document.getElementById("photo-gallery"),
    statHackathons: document.getElementById("stat-hackathons"),
    statMembers: document.getElementById("stat-members"),
    formMember: document.getElementById("form-member"),
    formPast: document.getElementById("form-past"),
    formUpcoming: document.getElementById("form-upcoming"),
    formPhoto: document.getElementById("form-photo"),
    btnExport: document.getElementById("btn-export"),
    importFile: document.getElementById("import-file"),
    btnReset: document.getElementById("btn-reset"),
    nav: document.querySelector(".nav"),
    navToggle: document.querySelector(".nav-toggle"),
    manageLogin: document.getElementById("manage-login"),
    manageContent: document.getElementById("manage-content"),
    formAdminLogin: document.getElementById("form-admin-login"),
    adminLoginError: document.getElementById("admin-login-error"),
    adminNoPassword: document.getElementById("admin-no-password"),
    adminGateLead: document.getElementById("admin-gate-lead"),
    btnEditorLogout: document.getElementById("btn-editor-logout"),
  };

  function updateManageChrome() {
    const configured = isPasswordConfigured();
    const editor = isEditor();

    if (el.adminNoPassword) {
      if (!configured) {
        el.adminNoPassword.textContent =
          "Add config.js and set CLB_ADMIN_PASSWORD to a non-empty secret. Until then, no one can edit from the browser.";
        el.adminNoPassword.classList.remove("is-hidden");
      } else {
        el.adminNoPassword.classList.add("is-hidden");
      }
    }

    if (el.adminGateLead) {
      if (configured) el.adminGateLead.classList.remove("is-hidden");
      else el.adminGateLead.classList.add("is-hidden");
    }

    if (el.manageContent && el.manageLogin) {
      if (!configured) {
        el.manageContent.classList.add("is-hidden");
        el.manageLogin.classList.remove("is-hidden");
        if (el.formAdminLogin) el.formAdminLogin.classList.add("is-hidden");
      } else if (editor) {
        el.manageContent.classList.remove("is-hidden");
        el.manageLogin.classList.add("is-hidden");
        if (el.formAdminLogin) el.formAdminLogin.classList.remove("is-hidden");
      } else {
        el.manageContent.classList.add("is-hidden");
        el.manageLogin.classList.remove("is-hidden");
        if (el.formAdminLogin) el.formAdminLogin.classList.remove("is-hidden");
      }
    }

    if (el.btnEditorLogout) {
      if (configured && editor) el.btnEditorLogout.classList.remove("is-hidden");
      else el.btnEditorLogout.classList.add("is-hidden");
    }

    if (el.adminLoginError && !editor) {
      el.adminLoginError.classList.add("is-hidden");
      el.adminLoginError.textContent = "";
    }
  }

  function updateStats() {
    const hackCount = state.past.length + state.upcoming.length;
    el.statHackathons.textContent = String(hackCount);
    el.statMembers.textContent = String(state.members.length);
  }

  function memberInitials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return parts[0] ? parts[0][0].toUpperCase() : "?";
  }

  function buildMemberPhotoEl(m) {
    const src = sanitizeImgSrc(m.photo || "");
    const initials = memberInitials(m.name);
    const nameStr = String(m.name || "Team member");
    const wrap = document.createElement("div");
    wrap.className = "member-photo";

    function showBrokenImagePlaceholder() {
      wrap.innerHTML = "";
      wrap.classList.add("member-photo-placeholder");
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", nameStr);
      const span = document.createElement("span");
      span.className = "member-photo-initials";
      span.textContent = initials;
      wrap.appendChild(span);
      const hint = document.createElement("span");
      hint.className = "member-photo-fallback-msg";
      hint.textContent = "Not a displayable image URL";
      wrap.appendChild(hint);
    }

    if (!src) {
      wrap.classList.add("member-photo-placeholder");
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", nameStr);
      const span = document.createElement("span");
      span.className = "member-photo-initials";
      span.textContent = initials;
      wrap.appendChild(span);
      return wrap;
    }

    const img = document.createElement("img");
    img.alt = nameStr;
    img.width = 320;
    img.height = 320;
    img.loading = "lazy";
    img.decoding = "async";
    img.src = src;
    img.addEventListener(
      "error",
      () => {
        showBrokenImagePlaceholder();
      },
      { once: true }
    );
    wrap.appendChild(img);
    return wrap;
  }

  function renderTeam() {
    el.teamGrid.innerHTML = "";
    const canEdit = isEditor();
    if (!state.members.length) {
      el.teamGrid.innerHTML = '<p class="empty-state">No team members yet — add some below.</p>';
      return;
    }
    state.members.forEach((m) => {
      const card = document.createElement("article");
      card.className = "member-card";
      if (canEdit) {
        const act = document.createElement("div");
        act.className = "member-card-actions";
        act.innerHTML = `
        <button type="button" class="member-edit" data-edit-member="${escapeAttr(m.id)}">Edit</button>
        <button type="button" class="member-remove" data-remove-member="${escapeAttr(m.id)}" aria-label="Remove ${escapeAttr(m.name)}">×</button>`;
        card.appendChild(act);
      }
      card.appendChild(buildMemberPhotoEl(m));
      const h3 = document.createElement("h3");
      h3.textContent = m.name || "";
      card.appendChild(h3);
      const role = document.createElement("p");
      role.className = "member-role";
      role.textContent = m.role || "";
      card.appendChild(role);
      const bio = document.createElement("p");
      bio.className = "member-bio";
      bio.textContent = m.bio || "";
      card.appendChild(bio);
      if (m.link && String(m.link).trim()) {
        const a = document.createElement("a");
        a.className = "member-link";
        a.href = m.link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Profile / link →";
        card.appendChild(a);
      }
      el.teamGrid.appendChild(card);
    });
  }

  function renderPast() {
    el.pastList.innerHTML = "";
    const canEdit = isEditor();
    if (!state.past.length) {
      el.pastList.innerHTML = '<p class="empty-state">No past events yet.</p>';
      return;
    }
    const sorted = [...state.past].sort((a, b) => String(b.when).localeCompare(String(a.when)));
    sorted.forEach((p) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      const removeBtn = canEdit
        ? `<button type="button" class="remove-btn timeline-remove" data-remove-past="${p.id}">Remove</button>`
        : "";
      item.innerHTML = `
        <span class="when">${escapeHtml(p.when || "—")}</span>
        <h3>${escapeHtml(p.title)}</h3>
        <p class="highlight">${escapeHtml(p.highlight || "")}</p>
        ${removeBtn}
      `;
      el.pastList.appendChild(item);
    });
  }

  function renderUpcoming() {
    el.upcomingList.innerHTML = "";
    const canEdit = isEditor();
    if (!state.upcoming.length) {
      el.upcomingList.innerHTML = '<p class="empty-state">No upcoming events — add your next hackathon.</p>';
      return;
    }
    const sorted = [...state.upcoming].sort((a, b) => String(a.when).localeCompare(String(b.when)));
    sorted.forEach((u) => {
      const card = document.createElement("article");
      card.className = "upcoming-card";
      const removeBtn = canEdit
        ? `<button type="button" class="remove-btn upcoming-remove" data-remove-upcoming="${u.id}">Remove</button>`
        : "";
      card.innerHTML = `
        <div>
          <h3>${escapeHtml(u.title)}</h3>
          <p class="upcoming-meta">${escapeHtml(u.when)}${u.where ? " · " + escapeHtml(u.where) : ""}</p>
        </div>
        ${removeBtn}
        ${u.notes ? `<p class="upcoming-notes">${escapeHtml(u.notes)}</p>` : ""}
      `;
      el.upcomingList.appendChild(card);
    });
  }

  function renderPhotos() {
    el.photoGallery.innerHTML = "";
    const canEdit = isEditor();
    if (!state.photos.length) {
      el.photoGallery.innerHTML =
        '<p class="empty-state">No photos yet — add image URLs or paths in Manage, or drop files into <code>images/</code> and reference them.</p>';
      return;
    }
    state.photos.forEach((ph) => {
      const src = sanitizeImgSrc(ph.src);
      if (!src) return;
      const cap = String(ph.caption || "").trim();
      const alt = cap || "Hackathon team photo";
      const figure = document.createElement("figure");
      figure.className = "photo-card";
      const removeBtn = canEdit
        ? `<button type="button" class="remove-btn photo-remove" data-remove-photo="${ph.id}" aria-label="Remove photo">Remove</button>`
        : "";
      figure.insertAdjacentHTML(
        "beforeend",
        `${removeBtn}<div class="photo-img-wrap"></div>${cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : "<figcaption></figcaption>"}`
      );
      const wrap = figure.querySelector(".photo-img-wrap");
      const img = document.createElement("img");
      img.alt = alt;
      img.loading = "lazy";
      img.decoding = "async";
      img.src = src;
      img.addEventListener(
        "error",
        () => {
          wrap.classList.add("photo-broken");
          wrap.innerHTML = "";
          wrap.textContent =
            "This isn’t a direct image link. Use a URL that ends in .jpg / .png or upload a file from your PC.";
        },
        { once: true }
      );
      wrap.appendChild(img);
      el.photoGallery.appendChild(figure);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function renderAll() {
    renderTeam();
    renderPhotos();
    renderPast();
    renderUpcoming();
    updateStats();
    updateManageChrome();
  }

  function guardEditor() {
    if (!isEditor()) {
      alert("Sign in as editor in Manage to change content.");
      return false;
    }
    return true;
  }

  function updateMemberFormUi() {
    const editing = Boolean(editingMemberId);
    const member = editingMemberId ? state.members.find((x) => x.id === editingMemberId) : null;
    const hasPhoto = Boolean(member && String(member.photo || "").trim());
    const title = document.getElementById("member-form-title");
    const submitBtn = document.getElementById("btn-member-submit");
    const cancelBtn = document.getElementById("btn-member-cancel-edit");
    const removePhotoWrap = document.getElementById("member-remove-photo-wrap");
    if (title) title.textContent = editing ? "Edit team member" : "Add team member";
    if (submitBtn) submitBtn.textContent = editing ? "Save changes" : "Add member";
    if (cancelBtn) cancelBtn.classList.toggle("is-hidden", !editing);
    if (removePhotoWrap) removePhotoWrap.classList.toggle("is-hidden", !editing || !hasPhoto);
  }

  function resetMemberForm() {
    editingMemberId = null;
    const hid = document.getElementById("form-member-id");
    if (hid) hid.value = "";
    memberPhotoDataUrl = null;
    if (memberPhotoFile) memberPhotoFile.value = "";
    if (memberPhotoHint) {
      memberPhotoHint.textContent = "";
      memberPhotoHint.classList.add("is-hidden");
    }
    el.formMember.reset();
    const cb = el.formMember.querySelector('[name="removePhoto"]');
    if (cb) cb.checked = false;
    updateMemberFormUi();
  }

  function startEditMember(id) {
    const m = state.members.find((x) => x.id === id);
    if (!m) return;
    editingMemberId = id;
    const hid = document.getElementById("form-member-id");
    if (hid) hid.value = id;
    el.formMember.elements.name.value = m.name || "";
    el.formMember.elements.role.value = m.role || "";
    el.formMember.elements.bio.value = m.bio || "";
    el.formMember.elements.link.value = m.link || "";
    const ph = String(m.photo || "");
    if (el.formMember.elements.photo) {
      el.formMember.elements.photo.value = ph.startsWith("data:") ? "" : ph;
    }
    memberPhotoDataUrl = null;
    if (memberPhotoFile) memberPhotoFile.value = "";
    if (memberPhotoHint) {
      if (ph) {
        memberPhotoHint.textContent = ph.startsWith("data:")
          ? "Profile photo is saved in browser data — upload a new file or paste a URL to replace it."
          : "Change the URL above, upload a new file, or check “Remove profile photo” to clear it.";
        memberPhotoHint.classList.remove("is-hidden");
      } else {
        memberPhotoHint.textContent = "";
        memberPhotoHint.classList.add("is-hidden");
      }
    }
    const cb = el.formMember.querySelector('[name="removePhoto"]');
    if (cb) cb.checked = false;
    updateMemberFormUi();
  }

  el.teamGrid.addEventListener("click", (e) => {
    const editId = e.target.getAttribute("data-edit-member");
    if (editId) {
      if (!guardEditor()) return;
      startEditMember(editId);
      document.getElementById("manage")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const id = e.target.getAttribute("data-remove-member");
    if (!id || !guardEditor()) return;
    if (id === editingMemberId) resetMemberForm();
    state.members = state.members.filter((m) => m.id !== id);
    saveData(state);
    renderAll();
  });

  el.pastList.addEventListener("click", (e) => {
    const id = e.target.getAttribute("data-remove-past");
    if (!id || !guardEditor()) return;
    state.past = state.past.filter((p) => p.id !== id);
    saveData(state);
    renderAll();
  });

  el.upcomingList.addEventListener("click", (e) => {
    const id = e.target.getAttribute("data-remove-upcoming");
    if (!id || !guardEditor()) return;
    state.upcoming = state.upcoming.filter((u) => u.id !== id);
    saveData(state);
    renderAll();
  });

  el.photoGallery.addEventListener("click", (e) => {
    const id = e.target.getAttribute("data-remove-photo");
    if (!id || !guardEditor()) return;
    state.photos = state.photos.filter((p) => p.id !== id);
    saveData(state);
    renderAll();
  });

  const memberPhotoFile = document.getElementById("member-photo-file");
  const memberPhotoHint = document.getElementById("member-photo-hint");
  const galleryPhotoFile = document.getElementById("gallery-photo-file");
  const galleryPhotoHint = document.getElementById("gallery-photo-hint");

  if (memberPhotoFile) {
    memberPhotoFile.addEventListener("change", async () => {
      const f = memberPhotoFile.files[0];
      if (!f) {
        memberPhotoDataUrl = null;
        if (memberPhotoHint) memberPhotoHint.classList.add("is-hidden");
        return;
      }
      const src = await imageFileToStoredSrc(f);
      if (!src) {
        memberPhotoFile.value = "";
        memberPhotoDataUrl = null;
        if (memberPhotoHint) memberPhotoHint.classList.add("is-hidden");
        return;
      }
      memberPhotoDataUrl = src;
      if (memberPhotoHint) {
        memberPhotoHint.textContent = "Using: " + f.name + " (stored in browser data)";
        memberPhotoHint.classList.remove("is-hidden");
      }
    });
  }

  if (galleryPhotoFile) {
    galleryPhotoFile.addEventListener("change", async () => {
      const f = galleryPhotoFile.files[0];
      if (!f) {
        galleryPhotoDataUrl = null;
        if (galleryPhotoHint) galleryPhotoHint.classList.add("is-hidden");
        return;
      }
      const src = await imageFileToStoredSrc(f);
      if (!src) {
        galleryPhotoFile.value = "";
        galleryPhotoDataUrl = null;
        if (galleryPhotoHint) galleryPhotoHint.classList.add("is-hidden");
        return;
      }
      galleryPhotoDataUrl = src;
      if (galleryPhotoHint) {
        galleryPhotoHint.textContent = "Using: " + f.name + " (stored in browser data)";
        galleryPhotoHint.classList.remove("is-hidden");
      }
    });
  }

  el.formMember.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!guardEditor()) return;
    const fd = new FormData(el.formMember);
    const memberId = String(fd.get("memberId") || "").trim();
    const existing = memberId ? state.members.find((x) => x.id === memberId) : null;

    let photo = "";
    if (memberId && existing) {
      if (fd.get("removePhoto")) photo = "";
      else if (memberPhotoDataUrl) photo = memberPhotoDataUrl;
      else {
        const text = sanitizeImgSrc(String(fd.get("photo") || "").trim());
        photo = text !== "" ? text : existing.photo || "";
      }
    } else {
      photo = memberPhotoDataUrl || sanitizeImgSrc(String(fd.get("photo") || "").trim());
    }

    memberPhotoDataUrl = null;
    if (memberPhotoFile) memberPhotoFile.value = "";
    if (memberPhotoHint) {
      memberPhotoHint.textContent = "";
      memberPhotoHint.classList.add("is-hidden");
    }

    const payload = {
      photo,
      name: String(fd.get("name") || "").trim(),
      role: String(fd.get("role") || "").trim(),
      bio: String(fd.get("bio") || "").trim(),
      link: String(fd.get("link") || "").trim(),
    };

    if (memberId && existing) {
      Object.assign(existing, payload);
    } else {
      state.members.push({ id: uid("m"), ...payload });
    }

    saveData(state);
    resetMemberForm();
    renderAll();
  });

  document.getElementById("btn-member-cancel-edit")?.addEventListener("click", () => {
    if (!guardEditor()) return;
    resetMemberForm();
  });

  el.formPast.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!guardEditor()) return;
    const fd = new FormData(el.formPast);
    state.past.push({
      id: uid("p"),
      title: String(fd.get("title") || "").trim(),
      when: String(fd.get("when") || "").trim(),
      highlight: String(fd.get("highlight") || "").trim(),
    });
    saveData(state);
    el.formPast.reset();
    renderAll();
  });

  el.formUpcoming.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!guardEditor()) return;
    const fd = new FormData(el.formUpcoming);
    state.upcoming.push({
      id: uid("u"),
      title: String(fd.get("title") || "").trim(),
      when: String(fd.get("when") || "").trim(),
      where: String(fd.get("where") || "").trim(),
      notes: String(fd.get("notes") || "").trim(),
    });
    saveData(state);
    el.formUpcoming.reset();
    renderAll();
  });

  el.formPhoto.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!guardEditor()) return;
    const fd = new FormData(el.formPhoto);
    const src = galleryPhotoDataUrl || sanitizeImgSrc(String(fd.get("src") || "").trim());
    galleryPhotoDataUrl = null;
    if (galleryPhotoFile) galleryPhotoFile.value = "";
    if (galleryPhotoHint) {
      galleryPhotoHint.textContent = "";
      galleryPhotoHint.classList.add("is-hidden");
    }
    if (!src) {
      alert("Choose an image from your PC or enter a URL / path.");
      return;
    }
    state.photos.push({
      id: uid("ph"),
      src,
      caption: String(fd.get("caption") || "").trim(),
    });
    saveData(state);
    el.formPhoto.reset();
    renderAll();
  });

  el.btnExport.addEventListener("click", () => {
    if (!guardEditor()) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "code-lanka-breakers-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  el.importFile.addEventListener("change", () => {
    if (!guardEditor()) {
      el.importFile.value = "";
      return;
    }
    const file = el.importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        state = normalizeState(data);
        saveData(state);
        renderAll();
      } catch (err) {
        alert("Could not import: file must be valid JSON with members, past, upcoming, and photos arrays.");
      }
      el.importFile.value = "";
    };
    reader.readAsText(file);
  });

  el.btnReset.addEventListener("click", () => {
    if (!guardEditor()) return;
    if (!confirm("Reset all content to the default sample data? This clears local storage.")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = structuredClone(window.CLB_DEFAULT_DATA);
    saveData(state);
    renderAll();
  });

  if (el.formAdminLogin) {
    el.formAdminLogin.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!isPasswordConfigured()) return;
      const fd = new FormData(el.formAdminLogin);
      const attempt = String(fd.get("password") || "");
      const expected = getExpectedPassword();
      if (attempt === expected) {
        setEditorSession(true);
        if (el.adminLoginError) {
          el.adminLoginError.classList.add("is-hidden");
          el.adminLoginError.textContent = "";
        }
        el.formAdminLogin.reset();
        renderAll();
      } else {
        if (el.adminLoginError) {
          el.adminLoginError.textContent = "That password is not correct.";
          el.adminLoginError.classList.remove("is-hidden");
        }
      }
    });
  }

  if (el.btnEditorLogout) {
    el.btnEditorLogout.addEventListener("click", () => {
      setEditorSession(false);
      if (el.nav) el.nav.classList.remove("is-open");
      if (el.navToggle) el.navToggle.setAttribute("aria-expanded", "false");
      renderAll();
    });
  }

  if (el.navToggle && el.nav) {
    el.navToggle.addEventListener("click", () => {
      const open = el.nav.classList.toggle("is-open");
      el.navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    el.nav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        el.nav.classList.remove("is-open");
        el.navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  renderAll();
})();
