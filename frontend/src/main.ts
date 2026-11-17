import "./style.css";
import {
  type Branding,
  type Comment,
  type CommentNode,
  type Community,
  type Post,
  type Route,
  type Sort,
  type User,
  buildCommentTree,
  countDescendants,
  escapeHTML,
  formatCount,
  hostname,
  hueFor,
  initials,
  parseRoute,
  plural,
  safeUrl,
  sortPosts,
  timeAgo,
} from "./utils";

/* ------------------------------------------------------------------ *
 *  Settings you may want to tweak
 * ------------------------------------------------------------------ */

const COMMUNITY_PREFIX = "r/"; // change to "c/" if you prefer your own naming
const USER_PREFIX = "u/";
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MOD_ROLES = ["owner", "admin", "moderator"];

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */

type ListResponse<T> = T[] | { results?: T[] };

const app = document.querySelector<HTMLDivElement>("#app")!;

const state = {
  user: null as User | null,
  communities: [] as Community[],
  branding: {
    site_name: "OnConnect",
    tagline: "Research • Develop • Connect",
    logo_url: null,
    app_icon_url: null,
  } as Branding,

  route: parseRoute(window.location.hash) as Route,
  sort: "hot" as Sort,
  loading: true,
  error: "",

  feed: [] as Post[],
  community: null as Community | null,
  post: null as Post | null,
  comments: [] as Comment[],
  collapsed: new Set<number>(),
  replyTo: null as number | null,
  searchPosts: [] as Post[],
  searchCommunities: [] as Community[],

  pending: new Set<string>(),
  submitKind: "text" as "text" | "link",
  submitFiles: [] as File[],
};

let navToken = 0;

/* ------------------------------------------------------------------ *
 *  API helper
 * ------------------------------------------------------------------ */

function csrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function ensureCSRF(): Promise<void> {
  if (csrfToken()) return;
  await fetch("/api/auth/csrf/", { credentials: "include" });
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const method = (options.method || "GET").toUpperCase();

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    await ensureCSRF();
    headers.set("X-CSRFToken", csrfToken());
  }

  const response = await fetch(path, { ...options, headers, credentials: "include" });
  const text = await response.text();
  let data: Record<string, unknown> = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text ? "Unexpected server response." : "" };
  }

  if (!response.ok) {
    const flattened = Object.values(data)
      .flat()
      .filter((value) => typeof value === "string")
      .join(" ");

    const message =
      (typeof data.detail === "string" && data.detail) ||
      (typeof data.error === "string" && data.error) ||
      flattened ||
      `Request failed (${response.status})`;

    throw new Error(message);
  }

  return data as T;
}

function listOf<T>(data: ListResponse<T>): T[] {
  return Array.isArray(data) ? data : data.results ?? [];
}

function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ------------------------------------------------------------------ *
 *  Small UI helpers
 * ------------------------------------------------------------------ */

const ICONS: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.2 1.3.8 2 1.6 2.3C10.3 8 10.5 5.5 12 3z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  up: '<path d="M12 3 3 13h5.5v8h7v-8H21z"/>',
  down: '<path d="M12 21 3 11h5.5V3h7v8H21z"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  chart: '<path d="M5 20v-8M12 20V5M19 20v-5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sliders: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

function icon(name: string, extraClass = ""): string {
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

type Mode = "light" | "dark" | "system";
type Density = "card" | "compact";
type Prefs = { mode: Mode; accent: string; density: Density };
type Accent = { label: string; light: [string, string]; dark: [string, string] };

/* [colour, hover colour] for each accent in light and dark mode */
const ACCENTS: Record<string, Accent> = {
  blue: { label: "Blue", light: ["#0079d3", "#0069b8"], dark: ["#4aa3ff", "#7bbcff"] },
  green: { label: "Green", light: ["#0f9d58", "#0b7a44"], dark: ["#3ddc84", "#6ee7a5"] },
  purple: { label: "Purple", light: ["#7c3aed", "#6428c9"], dark: ["#a78bfa", "#c4b5fd"] },
  pink: { label: "Pink", light: ["#e0307a", "#c0235f"], dark: ["#ff6fa5", "#ff94bd"] },
  teal: { label: "Teal", light: ["#0e9aa7", "#0a7d88"], dark: ["#2dd4bf", "#5eead4"] },
  red: { label: "Red", light: ["#d62828", "#b01f1f"], dark: ["#ff6b6b", "#ff8e8e"] },
};

const PREFS_KEY = "onconnect-appearance";
const DEFAULT_PREFS: Prefs = { mode: "system", accent: "default", density: "card" };
let prefs: Prefs = { ...DEFAULT_PREFS };

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (saved && typeof saved === "object") {
      return {
        mode: ["light", "dark", "system"].includes(saved.mode) ? saved.mode : "system",
        accent: saved.accent in ACCENTS ? saved.accent : "default",
        density: saved.density === "compact" ? "compact" : "card",
      };
    }
  } catch {
    /* ignore corrupted storage */
  }

  const legacy = localStorage.getItem("onconnect-theme"); // older versions
  return { ...DEFAULT_PREFS, mode: legacy === "dark" || legacy === "light" ? legacy : "system" };
}

function resolvedTheme(): "light" | "dark" {
  if (prefs.mode === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return prefs.mode;
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyAppearance(): void {
  const root = document.documentElement;
  const theme = resolvedTheme();

  root.dataset.theme = theme;
  root.dataset.density = prefs.density;

  const names = ["--brand", "--brand-hover", "--upvote", "--primary", "--primary-hover"];
  const accent: Accent | undefined = ACCENTS[prefs.accent];

  if (!accent) {
    names.forEach((name) => root.style.removeProperty(name));
  } else {
    const [color, hover] = theme === "dark" ? accent.dark : accent.light;
    root.style.setProperty("--brand", color);
    root.style.setProperty("--brand-hover", hover);
    root.style.setProperty("--upvote", color);
    root.style.setProperty("--primary", color);
    root.style.setProperty("--primary-hover", hover);
  }

  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  applyAppearance();
  renderNav();
}

function toast(message: string, type: "success" | "error" = "success"): void {
  const element = document.querySelector<HTMLDivElement>("#toast");
  if (!element) return;

  element.textContent = message;
  element.className = `toast show ${type}`;
  element.setAttribute("role", type === "error" ? "alert" : "status");

  window.setTimeout(() => element.classList.remove("show"), 3400);
}

function userAvatar(name: string, size: "sm" | "md" | "lg" = "md", url?: string): string {
  const image = safeUrl(url);
  if (image) {
    return `<img class="avatar ${size}" src="${escapeHTML(image)}" alt="">`;
  }

  return `<span class="avatar ${size}" style="--hue:${hueFor(name || "?")}" aria-hidden="true">${escapeHTML(initials(name || "?"))}</span>`;
}

function communityAvatar(name: string, imageUrl?: string, size: "sm" | "md" | "lg" = "sm"): string {
  const image = safeUrl(imageUrl);
  if (image) {
    return `<img class="avatar c-avatar ${size}" src="${escapeHTML(image)}" alt="">`;
  }

  return `<span class="avatar c-avatar ${size}" style="--hue:${hueFor(name)}" aria-hidden="true">${escapeHTML((name[0] || "?").toUpperCase())}</span>`;
}

function communityById(id: number): Community | undefined {
  return state.communities.find((c) => c.id === id) ?? (state.community?.id === id ? state.community : undefined);
}

function communityBySlug(slug: string): Community | undefined {
  return state.communities.find((c) => c.slug === slug) ?? (state.community?.slug === slug ? state.community : undefined);
}

function joinedCommunities(): Community[] {
  return state.communities.filter((c) => c.is_member);
}

function canModerate(community: Community | undefined): boolean {
  return !!community?.my_role && MOD_ROLES.includes(community.my_role);
}

function canDeletePost(post: Post): boolean {
  if (!state.user) return false;
  return post.author === state.user.id || canModerate(communityById(post.community));
}

function canDeleteComment(comment: Comment): boolean {
  if (!state.user) return false;
  const post = state.post;
  const community = post ? communityById(post.community) : undefined;
  return comment.author === state.user.id || canModerate(community);
}

function userName(user: User): string {
  return user.display_name || user.username;
}

/* ------------------------------------------------------------------ *
 *  Chrome: navbar, left navigation, page container
 * ------------------------------------------------------------------ */

function renderChrome(): void {
  app.innerHTML = `
    <header id="nav" class="navbar"></header>
    <div class="scrim" data-action="close-drawer"></div>
    <div class="layout">
      <aside id="left" class="left-nav" aria-label="Primary"></aside>
      <main id="page" class="page" tabindex="-1"></main>
    </div>
    <div id="modal-root"></div>
    <div id="toast" class="toast" aria-live="polite"></div>`;
}

function createHref(): string {
  const route = state.route;
  return route.name === "community" ? `#/submit/${encodeURIComponent(route.slug)}` : "#/submit";
}

function renderNav(): void {
  const nav = document.querySelector<HTMLElement>("#nav");
  if (!nav) return;

  const brand = state.branding;
  const logo = safeUrl(brand.logo_url);
  const searchValue = state.route.name === "search" ? state.route.q : "";
  const user = state.user;

  nav.innerHTML = `
    <button class="icon-btn nav-menu-btn" data-action="toggle-drawer" aria-label="Open navigation">${icon("menu")}</button>
    <a class="brand" href="#/" aria-label="${escapeHTML(brand.site_name)} home">
      ${logo ? `<img class="logo-img" src="${escapeHTML(logo)}" alt="">` : `<span class="logo-mark">OC</span>`}
      <span class="brand-name">${escapeHTML(brand.site_name)}</span>
    </a>

    <form class="search" data-form="search" role="search">
      ${icon("search")}
      <input name="q" type="search" autocomplete="off" aria-label="Search"
        placeholder="Search ${escapeHTML(brand.site_name)}" value="${escapeHTML(searchValue)}">
    </form>

    <div class="nav-actions">
      <button class="icon-btn" data-action="toggle-theme" aria-label="Switch light/dark mode" title="Light / dark">
        ${icon(currentTheme() === "dark" ? "sun" : "moon")}
      </button>
      <button class="icon-btn" data-action="open-appearance" aria-label="Appearance settings" title="Appearance">${icon("sliders")}</button>
      <a class="btn btn-outline nav-create" href="${createHref()}">${icon("plus")}<span>Create</span></a>
      ${
        user
          ? `
        <div class="menu-wrap">
          <button class="user-btn" data-action="toggle-menu" aria-haspopup="menu" aria-expanded="false">
            ${userAvatar(userName(user), "sm", user.avatar_url)}
            <span class="user-btn-text"><strong>${escapeHTML(userName(user))}</strong><small>${USER_PREFIX}${escapeHTML(user.username)}</small></span>
            ${icon("chevron", "chev")}
          </button>
          <div class="menu" role="menu">
            <a role="menuitem" href="#/u/${encodeURIComponent(user.username)}">${icon("user")} Profile</a>
            <button role="menuitem" data-action="edit-profile">${icon("camera")} Edit profile</button>
            <button role="menuitem" data-action="open-appearance">${icon("sliders")} Appearance</button>
            ${user.is_staff ? `<a role="menuitem" href="#/settings">${icon("settings")} Brand settings</a>` : ""}
            <button role="menuitem" data-action="logout">${icon("logout")} Log Out</button>
          </div>
        </div>`
          : `
        <button class="btn btn-brand" data-action="open-login">Log In</button>
        <button class="btn btn-outline hide-sm" data-action="open-register">Sign Up</button>`
      }
    </div>`;
}

function renderLeft(): void {
  const left = document.querySelector<HTMLElement>("#left");
  if (!left) return;

  const route = state.route;
  const navItem = (href: string, label: string, iconName: string, active: boolean) =>
    `<a class="side-item ${active ? "active" : ""}" href="${href}">${icon(iconName)}<span>${label}</span></a>`;

  const communityItem = (c: Community) => `
    <a class="side-item side-community ${route.name === "community" && route.slug === c.slug ? "active" : ""}"
       href="#/c/${encodeURIComponent(c.slug)}">
      ${communityAvatar(c.name, c.image_url)}
      <span>${COMMUNITY_PREFIX}${escapeHTML(c.name)}</span>
    </a>`;

  const mine = joinedCommunities();
  const others = state.communities.filter((c) => !c.is_member).slice(0, 8);

  left.innerHTML = `
    <nav class="side-section">
      ${navItem("#/", "Home", "home", route.name === "home")}
      ${navItem("#/popular", "Popular", "flame", route.name === "popular")}
      ${navItem("#/communities", "Explore", "compass", route.name === "communities")}
    </nav>

    <nav class="side-section">
      <div class="side-label">Communities</div>
      <button class="side-item" data-action="create-community">${icon("plus")}<span>Create a community</span></button>
      ${mine.length ? `<div class="side-sublabel">Your communities</div>${mine.map(communityItem).join("")}` : ""}
      ${others.length ? `<div class="side-sublabel">${mine.length ? "Discover" : "Communities"}</div>${others.map(communityItem).join("")}` : ""}
      ${!state.communities.length ? `<p class="side-empty">No communities yet.</p>` : ""}
    </nav>

    <footer class="side-footer">
      <span>${escapeHTML(state.branding.tagline)}</span>
      <span>© ${new Date().getFullYear()} ${escapeHTML(state.branding.site_name)}</span>
    </footer>`;
}

/* ------------------------------------------------------------------ *
 *  Reusable view pieces
 * ------------------------------------------------------------------ */

function layout(main: string, rail: string): string {
  return `
    <div class="page-grid">
      <section class="col-main">${main}</section>
      <aside class="col-rail">${rail}</aside>
    </div>`;
}

function emptyState(title: string, text: string, actions = ""): string {
  return `
    <div class="card empty-state">
      <div class="empty-art">${icon("comment")}</div>
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(text)}</p>
      ${actions ? `<div class="empty-actions">${actions}</div>` : ""}
    </div>`;
}

function joinButton(community: Community, size = ""): string {
  if (community.my_role === "owner") {
    return `<span class="role-badge">You own this</span>`;
  }

  if (community.is_member) {
    return `<button class="btn btn-outline joined ${size}" data-action="toggle-join" data-slug="${escapeHTML(community.slug)}">
      <span class="when-idle">Joined</span><span class="when-hover">Leave</span></button>`;
  }

  if (state.pending.has(community.slug)) {
    return `<button class="btn btn-outline ${size}" disabled>Requested</button>`;
  }

  return `<button class="btn btn-primary ${size}" data-action="toggle-join" data-slug="${escapeHTML(community.slug)}">Join</button>`;
}

function voteRail(post: Post): string {
  const scoreClass = post.my_vote === 1 ? "up" : post.my_vote === -1 ? "down" : "";

  return `
    <div class="vote-rail">
      <button class="vote vote-up ${post.my_vote === 1 ? "on" : ""}" data-action="vote" data-id="${post.id}" data-value="1"
        aria-label="Upvote" aria-pressed="${post.my_vote === 1}">${icon("up")}</button>
      <span class="score ${scoreClass}" aria-label="Score">${formatCount(post.score || 0)}</span>
      <button class="vote vote-down ${post.my_vote === -1 ? "on" : ""}" data-action="vote" data-id="${post.id}" data-value="-1"
        aria-label="Downvote" aria-pressed="${post.my_vote === -1}">${icon("down")}</button>
    </div>`;
}

function postCard(post: Post, full = false): string {
  const community = communityById(post.community);
  const communityLabel = `${COMMUNITY_PREFIX}${escapeHTML(post.community_name)}`;
  const authorName = post.username || "unknown";
  const link = post.post_type === "link" ? safeUrl(post.link_url) : "";
  const images = post.images ?? [];

  const media = full
    ? images
        .map(
          (image) => `
        <button class="media media-full" data-action="lightbox" data-src="${escapeHTML(image.image_url)}" aria-label="View image">
          <img src="${escapeHTML(image.image_url)}" alt="${escapeHTML(image.caption || post.title)}" loading="lazy">
        </button>`,
        )
        .join("")
    : images[0]
      ? `<div class="media">
          <img src="${escapeHTML(images[0].image_url)}" alt="${escapeHTML(images[0].caption || post.title)}" loading="lazy">
          ${images.length > 1 ? `<span class="media-count">${icon("image")} ${images.length}</span>` : ""}
        </div>`
      : "";

  const body = post.body
    ? `<div class="${full ? "post-body" : "post-snippet"}">${escapeHTML(post.body)}</div>`
    : "";

  const linkChip = link
    ? `<a class="link-chip" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer nofollow">
         ${icon("link")}<span>${escapeHTML(hostname(link))}</span>${icon("external")}
       </a>`
    : "";

  return `
    <article class="post ${full ? "post-full" : "post-clickable"}" data-post="${post.id}" ${full ? "" : `data-href="#/post/${post.id}"`}>
      ${voteRail(post)}
      <div class="post-main">
        <div class="post-meta">
          ${community ? communityAvatar(community.name, community.image_url) : communityAvatar(post.community_name)}
          ${
            community
              ? `<a class="meta-community" href="#/c/${encodeURIComponent(community.slug)}">${communityLabel}</a>`
              : `<span class="meta-community">${communityLabel}</span>`
          }
          <span class="dot">•</span>
          <span>Posted by <a href="#/u/${encodeURIComponent(authorName)}">${USER_PREFIX}${escapeHTML(authorName)}</a></span>
          <span class="dot">•</span>
          <time datetime="${escapeHTML(post.created_at)}" title="${escapeHTML(new Date(post.created_at).toLocaleString())}">${escapeHTML(timeAgo(post.created_at))}</time>
        </div>

        <h3 class="post-title">${full ? escapeHTML(post.title) : `<a href="#/post/${post.id}">${escapeHTML(post.title)}</a>`}</h3>
        ${linkChip}
        ${body}
        ${media}

        <div class="post-actions">
          <a class="pill" href="#/post/${post.id}">${icon("comment")}<span data-comment-count="${post.id}">${plural(post.comment_count || 0, "Comment")}</span></a>
          <button class="pill" data-action="share" data-id="${post.id}">${icon("share")}<span>Share</span></button>
          ${canDeletePost(post) ? `<button class="pill pill-danger" data-action="delete-post" data-id="${post.id}">${icon("trash")}<span>Delete</span></button>` : ""}
        </div>
      </div>
    </article>`;
}

function skeletonPost(): string {
  return `
    <div class="post skeleton-post" aria-hidden="true">
      <div class="vote-rail"></div>
      <div class="post-main">
        <div class="sk sk-line short"></div>
        <div class="sk sk-line title"></div>
        <div class="sk sk-line"></div>
        <div class="sk sk-line medium"></div>
      </div>
    </div>`;
}

function sortBar(): string {
  const tab = (sort: Sort, label: string, iconName: string) => `
    <button class="sort-tab ${state.sort === sort ? "active" : ""}" role="tab" aria-selected="${state.sort === sort}"
      data-action="sort" data-sort="${sort}">${icon(iconName)}<span>${label}</span></button>`;

  return `
    <div class="sort-bar card" role="tablist" aria-label="Sort posts">
      ${tab("hot", "Hot", "flame")}
      ${tab("new", "New", "sparkle")}
      ${tab("top", "Top", "chart")}
    </div>`;
}

function createPostBar(): string {
  const user = state.user;

  return `
    <div class="create-bar card">
      ${user ? userAvatar(userName(user), "md", user.avatar_url) : `<span class="avatar md ghost">${icon("user")}</span>`}
      <a class="create-input" href="${createHref()}">Create Post</a>
      <a class="icon-btn" href="${createHref()}" aria-label="Create an image post">${icon("image")}</a>
      <a class="icon-btn" href="${createHref()}" aria-label="Create a link post">${icon("link")}</a>
    </div>`;
}

function popularCommunitiesCard(): string {
  const top = [...state.communities].sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0)).slice(0, 5);
  if (!top.length) return "";

  return `
    <div class="card">
      <div class="card-head head-blue">Top communities</div>
      <ol class="rank-list">
        ${top
          .map(
            (c, index) => `
          <li>
            <span class="rank">${index + 1}</span>
            <a class="rank-main" href="#/c/${encodeURIComponent(c.slug)}">
              ${communityAvatar(c.name, c.image_url)}
              <span class="rank-text"><strong>${COMMUNITY_PREFIX}${escapeHTML(c.name)}</strong><small>${plural(c.member_count ?? 0, "member")}</small></span>
            </a>
            ${joinButton(c, "btn-sm")}
          </li>`,
          )
          .join("")}
      </ol>
      <div class="card-foot"><a class="btn btn-primary btn-block" href="#/communities">View all</a></div>
    </div>`;
}

function homeRail(): string {
  const brand = state.branding;

  return `
    <div class="card home-card">
      <div class="home-banner"></div>
      <div class="card-body">
        <h3 class="home-title">${icon("home")} Home</h3>
        <p>${escapeHTML(brand.tagline)}. Your personal ${escapeHTML(brand.site_name)} front page — a place to share research, ask questions and build together.</p>
        <a class="btn btn-primary btn-block" href="#/submit">Create Post</a>
        <button class="btn btn-outline btn-block" data-action="create-community">Create Community</button>
      </div>
    </div>
    ${popularCommunitiesCard()}
    <p class="rail-foot">© ${new Date().getFullYear()} ${escapeHTML(brand.site_name)}. All rights reserved.</p>`;
}

function communityRail(community: Community): string {
  const rules = (community.rules || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const created = community.created_at
    ? new Date(community.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";

  return `
    <div class="card">
      <div class="card-head">About community</div>
      <div class="card-body">
        <p class="about-text">${escapeHTML(community.description || "A place for research, development and knowledge sharing.")}</p>
        ${created ? `<p class="meta-line">Created ${escapeHTML(created)}</p>` : ""}
        <div class="stat-row">
          <div><strong>${formatCount(community.member_count ?? 0)}</strong><small>Members</small></div>
          <div><strong>${community.visibility === "private" ? "Private" : "Public"}</strong><small>Visibility</small></div>
        </div>
        ${community.owner_name ? `<p class="meta-line">Owner: ${escapeHTML(community.owner_name)}</p>` : ""}
        <a class="btn btn-primary btn-block" href="#/submit/${encodeURIComponent(community.slug)}">Create Post</a>
      </div>
    </div>
    ${
      rules.length
        ? `<div class="card">
            <div class="card-head">Community rules</div>
            <ol class="rules">${rules.map((rule) => `<li>${escapeHTML(rule)}</li>`).join("")}</ol>
          </div>`
        : ""
    }
    <p class="rail-foot">© ${new Date().getFullYear()} ${escapeHTML(state.branding.site_name)}.</p>`;
}

/* ------------------------------------------------------------------ *
 *  Pages
 * ------------------------------------------------------------------ */

function feedPage(): string {
  const route = state.route;
  const isCommunity = route.name === "community" && state.community;
  const community = state.community;

  const banner =
    isCommunity && community
      ? `
    <section class="community-header">
      <div class="community-banner" style="--hue:${hueFor(community.slug)}"></div>
      <div class="community-bar">
        <div class="community-bar-inner">
          ${communityAvatar(community.name, community.image_url, "lg")}
          <div class="community-title">
            <h1>${escapeHTML(community.name)}</h1>
            <span>${COMMUNITY_PREFIX}${escapeHTML(community.slug)} ${community.visibility === "private" ? `· ${icon("lock", "inline")} Private` : ""}</span>
          </div>
          <div class="community-cta">
            ${community.is_member ? `<a class="btn btn-outline" href="#/submit/${encodeURIComponent(community.slug)}">${icon("plus")} Create Post</a>` : ""}
            ${joinButton(community)}
          </div>
        </div>
      </div>
    </section>`
      : "";

  const title =
    route.name === "popular"
      ? `<div class="page-heading">${icon("flame")}<div><h1>Popular</h1><p>The most talked-about posts across every community.</p></div></div>`
      : "";

  const posts = state.feed.length
    ? state.feed.map((post) => postCard(post)).join("")
    : emptyState(
        isCommunity ? "This community has no posts yet" : "Nothing to see here yet",
        isCommunity ? "Be the first to share something with the community." : "Join a community or create a post to get the conversation started.",
        `<a class="btn btn-primary" href="${createHref()}">Create Post</a><a class="btn btn-outline" href="#/communities">Explore communities</a>`,
      );

  const main = `${title}${createPostBar()}${sortBar()}<div class="post-list">${posts}</div>`;
  const rail = isCommunity && community ? communityRail(community) : homeRail();

  return `${banner}${layout(main, rail)}`;
}

function postPage(): string {
  const post = state.post;
  if (!post) return errorPage("That post could not be found.");

  const community = communityById(post.community);
  const user = state.user;

  let composer: string;
  if (!user) {
    composer = `
      <div class="card callout">
        <p>Log in or sign up to leave a comment.</p>
        <div class="callout-actions">
          <button class="btn btn-outline" data-action="open-login">Log In</button>
          <button class="btn btn-brand" data-action="open-register">Sign Up</button>
        </div>
      </div>`;
  } else if (community && !community.is_member) {
    composer = `
      <div class="card callout">
        <p>Join <strong>${COMMUNITY_PREFIX}${escapeHTML(community.name)}</strong> to comment and vote.</p>
        <div class="callout-actions">${joinButton(community)}</div>
      </div>`;
  } else {
    composer = `
      <form class="card comment-composer" data-form="comment">
        <label class="sr-only" for="comment-body">Comment</label>
        <p class="composer-as">Comment as <a href="#/u/${encodeURIComponent(user.username)}">${USER_PREFIX}${escapeHTML(user.username)}</a></p>
        <textarea id="comment-body" name="body" required maxlength="5000" rows="4" placeholder="What are your thoughts?"></textarea>
        <div class="composer-actions"><button class="btn btn-primary" type="submit">Comment</button></div>
      </form>`;
  }

  const main = `
    <div class="back-row"><button class="link-btn" data-action="back">← Back</button></div>
    ${postCard(post, true)}
    ${composer}
    <section class="card comments-card" aria-label="Comments">
      <div class="card-head plain"><span id="comment-count-title">${plural(state.comments.length, "Comment")}</span></div>
      <div id="comment-tree" class="comment-tree">${commentTreeHTML()}</div>
    </section>`;

  const rail = community ? communityRail(community) : homeRail();
  return layout(main, rail);
}

function commentTreeHTML(): string {
  const tree = buildCommentTree(state.comments);
  if (!tree.length) {
    return `<div class="no-comments">${icon("comment")}<p><strong>No comments yet</strong><br>Be the first to share what you think.</p></div>`;
  }
  return tree.map((node) => commentHTML(node, 0)).join("");
}

function commentHTML(node: CommentNode, depth: number): string {
  const collapsed = state.collapsed.has(node.id);
  const name = node.username || "unknown";
  const hidden = countDescendants(node);

  const replyForm =
    state.replyTo === node.id
      ? `<form class="reply-form" data-form="reply" data-parent="${node.id}">
           <textarea name="body" required maxlength="5000" rows="3" placeholder="Reply to ${USER_PREFIX}${escapeHTML(name)}"></textarea>
           <div class="composer-actions">
             <button type="button" class="btn btn-outline btn-sm" data-action="cancel-reply">Cancel</button>
             <button type="submit" class="btn btn-primary btn-sm">Reply</button>
           </div>
         </form>`
      : "";

  return `
    <div class="comment ${collapsed ? "is-collapsed" : ""} depth-${Math.min(depth, 6)}" data-comment="${node.id}">
      <div class="comment-rail">
        ${userAvatar(name, "sm", node.author_avatar)}
        <button class="thread-line" data-action="toggle-comment" data-id="${node.id}"
          aria-label="${collapsed ? "Expand" : "Collapse"} thread" aria-expanded="${!collapsed}"></button>
      </div>
      <div class="comment-main">
        <div class="comment-meta">
          <a class="comment-author" href="#/u/${encodeURIComponent(name)}">${USER_PREFIX}${escapeHTML(name)}</a>
          <span class="dot">•</span>
          <time title="${escapeHTML(new Date(node.created_at).toLocaleString())}">${escapeHTML(timeAgo(node.created_at))}</time>
          ${collapsed ? `<button class="link-btn" data-action="toggle-comment" data-id="${node.id}">[+] ${hidden ? plural(hidden, "more reply", "more replies") : "expand"}</button>` : ""}
        </div>
        ${
          collapsed
            ? ""
            : `
        <div class="comment-text">${escapeHTML(node.body)}</div>
        <div class="comment-actions">
          <button class="pill" data-action="reply" data-id="${node.id}">${icon("comment")}<span>Reply</span></button>
          ${canDeleteComment(node) ? `<button class="pill pill-danger" data-action="delete-comment" data-id="${node.id}">${icon("trash")}<span>Delete</span></button>` : ""}
        </div>
        ${replyForm}
        <div class="comment-children">${node.children.map((child) => commentHTML(child, depth + 1)).join("")}</div>`
        }
      </div>
    </div>`;
}

function communitiesPage(): string {
  const list = state.communities;

  const rows = list.length
    ? list
        .map(
          (c, index) => `
      <li class="community-row">
        <span class="rank">${index + 1}</span>
        ${communityAvatar(c.name, c.image_url, "md")}
        <div class="community-row-main">
          <a href="#/c/${encodeURIComponent(c.slug)}"><strong>${COMMUNITY_PREFIX}${escapeHTML(c.name)}</strong></a>
          <small>${plural(c.member_count ?? 0, "member")} ${c.visibility === "private" ? "· Private" : ""}</small>
          <p>${escapeHTML(c.description || "A place for research, development and knowledge sharing.")}</p>
        </div>
        ${joinButton(c)}
      </li>`,
        )
        .join("")
    : `<li class="community-row-empty">No communities yet. Be the first to create one!</li>`;

  const main = `
    <div class="page-heading">${icon("compass")}<div><h1>Explore communities</h1><p>Find people working on the things you care about.</p></div></div>
    <div class="card"><ul class="community-list">${rows}</ul></div>`;

  const rail = `
    <div class="card">
      <div class="card-head">Start your own</div>
      <div class="card-body">
        <p>Create a community to bring researchers, learners and developers together.</p>
        <button class="btn btn-primary btn-block" data-action="create-community">Create Community</button>
      </div>
    </div>`;

  return layout(main, rail);
}

function searchPage(): string {
  const route = state.route;
  const q = route.name === "search" ? route.q : "";

  if (!q) {
    return layout(emptyState("Search", "Type something in the search bar to find posts and communities."), homeRail());
  }

  const communityHTML = state.searchCommunities.length
    ? `<div class="card">
         <div class="card-head">Communities</div>
         <ul class="community-list">${state.searchCommunities
           .map(
             (c) => `
           <li class="community-row">
             ${communityAvatar(c.name, c.image_url, "md")}
             <div class="community-row-main">
               <a href="#/c/${encodeURIComponent(c.slug)}"><strong>${COMMUNITY_PREFIX}${escapeHTML(c.name)}</strong></a>
               <small>${plural(c.member_count ?? 0, "member")}</small>
               <p>${escapeHTML(c.description || "")}</p>
             </div>
             ${joinButton(c)}
           </li>`,
           )
           .join("")}</ul>
       </div>`
    : "";

  const postsHTML = state.searchPosts.length
    ? state.searchPosts.map((post) => postCard(post)).join("")
    : emptyState(`No posts found for “${q}”`, "Try different keywords or check your spelling.");

  const main = `
    <div class="page-heading">${icon("search")}<div><h1>Results for “${escapeHTML(q)}”</h1><p>${plural(state.searchPosts.length, "post")} · ${plural(state.searchCommunities.length, "community", "communities")}</p></div></div>
    ${communityHTML}
    <div class="post-list">${postsHTML}</div>`;

  return layout(main, homeRail());
}

function userPage(): string {
  const route = state.route;
  if (route.name !== "user") return "";

  const username = route.username;
  const isMe = state.user?.username.toLowerCase() === username.toLowerCase();
  const displayName = isMe && state.user ? userName(state.user) : state.feed[0]?.author_name || username;
  const karma = state.feed.reduce((sum, post) => sum + (post.score || 0), 0);

  const posts = state.feed.length
    ? state.feed.map((post) => postCard(post)).join("")
    : emptyState(isMe ? "You haven't posted yet" : `${USER_PREFIX}${username} hasn't posted yet`, "Posts will show up here.");

  const main = `
    <section class="card profile-head">
      ${userAvatar(displayName, "lg", isMe ? state.user?.avatar_url : state.feed[0]?.author_avatar)}
      <div class="profile-info">
        <h1>${escapeHTML(displayName)}</h1>
        <span class="muted">${USER_PREFIX}${escapeHTML(username)}</span>
        ${isMe && state.user?.bio ? `<p class="profile-bio">${escapeHTML(state.user.bio)}</p>` : ""}
      </div>
      ${isMe ? `<button class="btn btn-outline" data-action="edit-profile">${icon("camera")} Edit profile</button>` : ""}
    </section>
    <div class="page-heading slim"><div><h2>Posts</h2></div></div>
    <div class="post-list">${posts}</div>`;

  const rail = `
    <div class="card">
      <div class="card-head">${USER_PREFIX}${escapeHTML(username)}</div>
      <div class="card-body">
        <div class="stat-row">
          <div><strong>${formatCount(state.feed.length)}</strong><small>Posts</small></div>
          <div><strong>${formatCount(karma)}</strong><small>Post score</small></div>
        </div>
        ${isMe ? `<a class="btn btn-primary btn-block" href="#/submit">Create Post</a>` : ""}
      </div>
    </div>`;

  return layout(main, rail);
}

function submitPage(): string {
  const route = state.route;
  const slug = route.name === "submit" ? route.slug : undefined;
  const joined = joinedCommunities();
  const preset = slug ? communityBySlug(slug) : undefined;

  if (!state.user) {
    return layout(
      `<h1 class="page-title">Create a post</h1>
       <div class="card callout">
         <p>You need an account to share a post.</p>
         <div class="callout-actions">
           <button class="btn btn-outline" data-action="open-login">Log In</button>
           <button class="btn btn-brand" data-action="open-register">Sign Up</button>
         </div>
       </div>`,
      homeRail(),
    );
  }

  const presetNotice =
    preset && !preset.is_member
      ? `<div class="card callout">
           <p>You need to join <strong>${COMMUNITY_PREFIX}${escapeHTML(preset.name)}</strong> before you can post there.</p>
           <div class="callout-actions">${joinButton(preset)}</div>
         </div>`
      : "";

  if (!joined.length) {
    return layout(
      `<h1 class="page-title">Create a post</h1>
       ${presetNotice}
       ${emptyState("Join a community to post", "Posts live inside communities. Join one — or create your own — to get started.", `<a class="btn btn-primary" href="#/communities">Explore communities</a><button class="btn btn-outline" data-action="create-community">Create Community</button>`)}`,
      homeRail(),
    );
  }

  const selected = preset?.is_member ? preset.slug : "";

  const main = `
    <h1 class="page-title">Create a post</h1>
    ${presetNotice}
    <form class="card form-card" data-form="submit" data-kind="${state.submitKind}">
      <label class="field">
        <span class="field-label">Community</span>
        <select name="community" required>
          <option value="" disabled ${selected ? "" : "selected"}>Choose a community</option>
          ${joined
            .map((c) => `<option value="${c.id}" ${c.slug === selected ? "selected" : ""}>${COMMUNITY_PREFIX}${escapeHTML(c.name)}</option>`)
            .join("")}
        </select>
      </label>

      <div class="tabs" role="tablist">
        <button type="button" class="tab ${state.submitKind === "text" ? "active" : ""}" role="tab" data-action="submit-kind" data-kind="text">${icon("comment")} Post</button>
        <button type="button" class="tab ${state.submitKind === "link" ? "active" : ""}" role="tab" data-action="submit-kind" data-kind="link">${icon("link")} Link</button>
      </div>

      <label class="field">
        <span class="field-label">Title <small id="title-count" class="counter">0/180</small></span>
        <input name="title" maxlength="180" required placeholder="An interesting title">
      </label>

      <label class="field kind-text">
        <span class="field-label">Text</span>
        <textarea name="body" rows="8" maxlength="20000" ${state.submitKind === "text" ? "required" : ""} placeholder="Share your ideas, findings, questions or progress…"></textarea>
      </label>

      <label class="field kind-link">
        <span class="field-label">URL</span>
        <input name="link_url" type="url" ${state.submitKind === "link" ? "required" : ""} placeholder="https://example.com/paper">
      </label>

      <div class="field">
        <span class="field-label">Images <small class="counter">optional · up to ${MAX_IMAGES}</small></span>
        <label class="dropzone" for="post-images">${icon("image")}<span>Click to add images <small>JPEG, PNG or WEBP · 5 MB each</small></span></label>
        <input id="post-images" class="sr-only" type="file" accept="${ALLOWED_IMAGE_TYPES.join(",")}" multiple>
        <div id="previews" class="previews"></div>
      </div>

      <div class="form-actions">
        <a class="btn btn-outline" href="${preset ? `#/c/${encodeURIComponent(preset.slug)}` : "#/"}">Cancel</a>
        <button class="btn btn-primary" type="submit">Post</button>
      </div>
    </form>`;

  const rail = `
    <div class="card">
      <div class="card-head">Posting etiquette</div>
      <ol class="rules">
        <li>Remember the human behind the screen.</li>
        <li>Behave like you would in real life.</li>
        <li>Look for the original source of content.</li>
        <li>Search for duplicates before posting.</li>
        <li>Read the community's rules.</li>
      </ol>
    </div>`;

  return layout(main, rail);
}

function settingsPage(): string {
  const user = state.user;

  if (!user) {
    return layout(
      emptyState("Sign in to continue", "Brand settings are only available to platform staff.", `<button class="btn btn-primary" data-action="open-login">Log In</button>`),
      homeRail(),
    );
  }

  if (!user.is_staff) {
    return layout(emptyState("Staff only", "Only platform staff can change the platform name, tagline and logo."), homeRail());
  }

  const brand = state.branding;
  const logo = safeUrl(brand.logo_url);

  const main = `
    <h1 class="page-title">Brand settings</h1>
    <form class="card form-card" data-form="branding">
      <div class="brand-preview">
        ${logo ? `<img class="logo-img lg" src="${escapeHTML(logo)}" alt="">` : `<span class="logo-mark lg">OC</span>`}
        <div><strong>${escapeHTML(brand.site_name)}</strong><p class="muted">${escapeHTML(brand.tagline)}</p></div>
      </div>
      <label class="field"><span class="field-label">Platform name</span><input name="site_name" maxlength="80" required value="${escapeHTML(brand.site_name)}"></label>
      <label class="field"><span class="field-label">Tagline</span><input name="tagline" maxlength="180" value="${escapeHTML(brand.tagline)}"></label>
      <label class="field"><span class="field-label">Logo <small class="counter">JPEG, PNG or WEBP · max 5 MB</small></span><input name="logo" type="file" accept="${ALLOWED_IMAGE_TYPES.join(",")}"></label>
      <label class="field"><span class="field-label">App icon <small class="counter">square image works best</small></span><input name="app_icon" type="file" accept="${ALLOWED_IMAGE_TYPES.join(",")}"></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save changes</button></div>
    </form>`;

  return layout(main, homeRail());
}

function errorPage(message: string): string {
  return layout(
    emptyState("We couldn’t load this page", message, `<a class="btn btn-primary" href="#/">Go home</a><button class="btn btn-outline" data-action="retry">Try again</button>`),
    homeRail(),
  );
}

function loadingPage(): string {
  const skeletons = [skeletonPost(), skeletonPost(), skeletonPost()].join("");
  return layout(`<div class="post-list">${skeletons}</div>`, `<div class="card"><div class="card-body"><div class="sk sk-line"></div><div class="sk sk-line medium"></div><div class="sk sk-line short"></div></div></div>`);
}

function pageHTML(): string {
  if (state.loading) return loadingPage();
  if (state.error) return errorPage(state.error);

  switch (state.route.name) {
    case "home":
    case "popular":
    case "community":
      return feedPage();
    case "post":
      return postPage();
    case "communities":
      return communitiesPage();
    case "search":
      return searchPage();
    case "user":
      return userPage();
    case "submit":
      return submitPage();
    case "settings":
      return settingsPage();
    default:
      return errorPage("That page doesn’t exist.");
  }
}

function renderPage(): void {
  const page = document.querySelector<HTMLElement>("#page");
  if (!page) return;

  page.innerHTML = pageHTML();

  if (state.route.name === "submit" && !state.loading) {
    renderPreviews();
  }
}

function updateTitle(): void {
  const route = state.route;
  const site = state.branding.site_name;
  let title = site;

  switch (route.name) {
    case "popular": title = `Popular — ${site}`; break;
    case "communities": title = `Explore communities — ${site}`; break;
    case "community": title = `${state.community?.name ?? route.slug} — ${site}`; break;
    case "post": title = `${state.post?.title ?? "Post"} — ${site}`; break;
    case "submit": title = `Create a post — ${site}`; break;
    case "search": title = route.q ? `${route.q} — ${site}` : `Search — ${site}`; break;
    case "user": title = `${USER_PREFIX}${route.username} — ${site}`; break;
    case "settings": title = `Brand settings — ${site}`; break;
    default: title = `${site} — ${state.branding.tagline}`;
  }

  document.title = title;
}

function applyBranding(): void {
  const appIcon = safeUrl(state.branding.app_icon_url);
  if (!appIcon) return;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = appIcon;
}

/* ------------------------------------------------------------------ *
 *  Data loading & navigation
 * ------------------------------------------------------------------ */

async function loadUser(): Promise<void> {
  try {
    const data = await api<{ user?: User } & Partial<User>>("/api/auth/me/");
    const user = data.user ?? (data.id ? (data as User) : null);
    state.user = user && user.username ? user : null;
  } catch {
    state.user = null;
  }
}

async function loadCommunities(): Promise<void> {
  try {
    state.communities = listOf(await api<ListResponse<Community>>("/api/communities/"));
  } catch {
    /* keep whatever we had */
  }
}

async function loadBranding(): Promise<void> {
  try {
    state.branding = { ...state.branding, ...(await api<Branding>("/api/branding/")) };
    applyBranding();
  } catch {
    /* defaults are fine */
  }
}

async function fetchFeed(route: Route): Promise<Post[]> {
  const params = new URLSearchParams();
  if (state.sort === "top") params.set("sort", "top");
  if (route.name === "community") params.set("community", route.slug);

  const query = params.toString();
  let posts = listOf(await api<ListResponse<Post>>(`/api/posts/${query ? `?${query}` : ""}`));

  if (route.name === "home" && state.user) {
    const joined = new Set(joinedCommunities().map((c) => c.id));
    if (joined.size) posts = posts.filter((post) => joined.has(post.community));
  }

  return state.sort === "hot" ? sortPosts(posts, "hot") : posts;
}

function friendlyError(error: unknown): string {
  const message = errorMessage(error, "Please try again in a moment.");
  return /not found/i.test(message) ? "It may have been removed, or it might belong to a private community." : message;
}

async function navigate(options: { keepScroll?: boolean } = {}): Promise<void> {
  const token = ++navToken;
  const route = parseRoute(window.location.hash);

  state.route = route;
  state.error = "";
  state.replyTo = null;
  document.body.classList.remove("drawer-open");

  const needsData = ["home", "popular", "community", "post", "search", "user"].includes(route.name);
  state.loading = needsData;

  if (route.name === "submit") {
    state.submitFiles = [];
  }

  if (!options.keepScroll) window.scrollTo(0, 0);

  renderNav();
  renderLeft();
  updateTitle();
  renderPage();

  /* pages that render immediately but still want fresh membership data */
  if (!needsData) {
    if (["submit", "communities"].includes(route.name)) {
      await loadCommunities();
      if (token !== navToken) return;
      renderLeft();
      renderPage();
    }
    return;
  }

  try {
    switch (route.name) {
      case "home":
      case "popular": {
        const feed = await fetchFeed(route);
        if (token !== navToken) return;
        state.feed = feed;
        break;
      }
      case "community": {
        const [community, feed] = await Promise.all([
          api<Community>(`/api/communities/${encodeURIComponent(route.slug)}/`),
          fetchFeed(route),
        ]);
        if (token !== navToken) return;
        state.community = community;
        state.feed = feed;
        break;
      }
      case "post": {
        const [post, comments] = await Promise.all([
          api<Post>(`/api/posts/${route.id}/`),
          api<ListResponse<Comment>>(`/api/posts/${route.id}/comments/`),
        ]);
        if (token !== navToken) return;
        state.post = post;
        state.comments = listOf(comments);
        state.collapsed.clear();
        break;
      }
      case "search": {
        if (route.q) {
          const query = encodeURIComponent(route.q);
          const [posts, communities] = await Promise.all([
            api<ListResponse<Post>>(`/api/posts/?search=${query}`),
            api<ListResponse<Community>>(`/api/communities/?search=${query}`),
          ]);
          if (token !== navToken) return;
          state.searchPosts = listOf(posts);
          state.searchCommunities = listOf(communities);
        } else {
          state.searchPosts = [];
          state.searchCommunities = [];
        }
        break;
      }
      case "user": {
        const all = listOf(await api<ListResponse<Post>>("/api/posts/"));
        if (token !== navToken) return;
        const wanted = route.username.toLowerCase();
        state.feed = sortPosts(
          all.filter((post) => post.username.toLowerCase() === wanted),
          "new",
        );
        break;
      }
    }
  } catch (error) {
    if (token !== navToken) return;
    state.error = friendlyError(error);
  }

  if (token !== navToken) return;

  state.loading = false;
  updateTitle();
  renderLeft();
  renderPage();
}

/* ------------------------------------------------------------------ *
 *  Modals
 * ------------------------------------------------------------------ */

function modalRoot(): HTMLElement {
  return document.querySelector<HTMLElement>("#modal-root")!;
}

function closeModal(): void {
  modalRoot().innerHTML = "";
  document.body.classList.remove("modal-open");
}

function showModal(title: string, body: string): void {
  modalRoot().innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <button class="icon-btn modal-close" data-action="close-modal" aria-label="Close">${icon("x")}</button>
        <h2>${escapeHTML(title)}</h2>
        ${body}
      </section>
    </div>`;
  document.body.classList.add("modal-open");

  modalRoot().querySelector<HTMLElement>("input, textarea, select")?.focus();
}

function authModal(mode: "login" | "register"): void {
  const register = mode === "register";

  showModal(
    register ? "Sign Up" : "Log In",
    `
    <p class="modal-sub">${register ? `Join ${escapeHTML(state.branding.site_name)} to share, discuss and build together.` : "Welcome back! Log in to continue."}</p>
    <form data-form="auth" data-mode="${mode}">
      ${register ? `<label class="field"><span class="field-label">Display name <small class="counter">optional</small></span><input name="display_name" maxlength="80" placeholder="Your name"></label>` : ""}
      <label class="field"><span class="field-label">Username</span><input name="username" required minlength="3" autocomplete="username" placeholder="Username"></label>
      ${register ? `<label class="field"><span class="field-label">Email</span><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>` : ""}
      <label class="field"><span class="field-label">Password</span><input name="password" type="password" required minlength="${register ? 8 : 1}" autocomplete="${register ? "new-password" : "current-password"}" placeholder="Password"></label>
      <button class="btn btn-brand btn-block btn-lg" type="submit">${register ? "Sign Up" : "Log In"}</button>
    </form>
    <p class="modal-switch">
      ${register ? "Already a member?" : `New to ${escapeHTML(state.branding.site_name)}?`}
      <button class="link-btn" data-action="${register ? "open-login" : "open-register"}">${register ? "Log In" : "Sign Up"}</button>
    </p>`,
  );
}

function communityModal(): void {
  if (!state.user) {
    authModal("login");
    return;
  }

  showModal(
    "Create a community",
    `
    <form data-form="community">
      <label class="field"><span class="field-label">Name <small class="counter">can’t be changed later</small></span>
        <input name="name" required maxlength="80" placeholder="e.g. AI Research Lab"></label>
      <label class="field"><span class="field-label">Description</span>
        <textarea name="description" rows="3" maxlength="2000" required placeholder="What is this community about?"></textarea></label>
      <label class="field"><span class="field-label">Rules <small class="counter">optional · one per line</small></span>
        <textarea name="rules" rows="3" maxlength="5000" placeholder="Be kind&#10;Cite your sources"></textarea></label>
      <fieldset class="field radios">
        <legend class="field-label">Community type</legend>
        <label class="radio"><input type="radio" name="visibility" value="public" checked>
          <span>${icon("users")}<span><strong>Public</strong><small>Anyone can view, post and comment</small></span></span></label>
        <label class="radio"><input type="radio" name="visibility" value="private">
          <span>${icon("lock")}<span><strong>Private</strong><small>People must request to join</small></span></span></label>
      </fieldset>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Create community</button>
      </div>
    </form>`,
  );
}

function appearanceModal(): void {
  const dark = currentTheme() === "dark";

  const seg = (action: string, current: string, options: [string, string, string][]) =>
    `<div class="seg" role="radiogroup">${options
      .map(
        ([value, label, iconName]) => `
      <button type="button" class="seg-btn ${current === value ? "on" : ""}" role="radio" aria-checked="${current === value}"
        data-action="${action}" data-value="${value}">${iconName ? icon(iconName) : ""}<span>${label}</span></button>`,
      )
      .join("")}</div>`;

  const swatch = (key: string, label: string, color: string) => `
    <button type="button" class="swatch ${prefs.accent === key ? "on" : ""}" style="--c:${color}" role="radio"
      aria-checked="${prefs.accent === key}" aria-label="${label}" title="${label}" data-action="set-accent" data-value="${key}">
      ${prefs.accent === key ? icon("check") : ""}
    </button>`;

  showModal(
    "Appearance",
    `
    <p class="modal-sub">Changes apply instantly and are saved on this device.</p>

    <section class="pref">
      <h3>Theme</h3>
      ${seg("set-mode", prefs.mode, [
        ["light", "Light", "sun"],
        ["dark", "Dark", "moon"],
        ["system", "System", "sliders"],
      ])}
    </section>

    <section class="pref">
      <h3>Accent colour</h3>
      <div class="swatches" role="radiogroup">
        <button type="button" class="swatch swatch-default ${prefs.accent === "default" ? "on" : ""}" role="radio"
          aria-checked="${prefs.accent === "default"}" aria-label="Default" title="Default" data-action="set-accent" data-value="default">
          ${prefs.accent === "default" ? icon("check") : ""}
        </button>
        ${Object.entries(ACCENTS)
          .map(([key, accent]) => swatch(key, accent.label, dark ? accent.dark[0] : accent.light[0]))
          .join("")}
      </div>
    </section>

    <section class="pref">
      <h3>Post layout</h3>
      ${seg("set-density", prefs.density, [
        ["card", "Card", ""],
        ["compact", "Compact", ""],
      ])}
    </section>

    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-action="reset-appearance">Reset</button>
      <button type="button" class="btn btn-primary" data-action="close-modal">Done</button>
    </div>`,
  );
}

function profileModal(): void {
  const user = state.user;
  if (!user) {
    authModal("login");
    return;
  }

  showModal(
    "Edit profile",
    `
    <form data-form="profile">
      <div class="avatar-editor">
        <div id="avatar-preview">${userAvatar(userName(user), "lg", user.avatar_url)}</div>
        <div class="avatar-actions">
          <div class="avatar-buttons">
            <label class="btn btn-outline btn-sm" for="avatar-input">${icon("camera")} Upload photo</label>
            <button type="button" class="btn btn-outline btn-sm" data-action="remove-avatar">Remove</button>
          </div>
          <small class="muted">JPEG, PNG or WEBP · max 5 MB</small>
        </div>
      </div>
      <label class="field"><span class="field-label">Display name</span>
        <input name="display_name" maxlength="80" value="${escapeHTML(user.display_name || "")}" placeholder="${escapeHTML(user.username)}"></label>
      <label class="field"><span class="field-label">About you <small class="counter">max 280 characters</small></span>
        <textarea name="bio" rows="3" maxlength="280" placeholder="Tell people a little about yourself">${escapeHTML(user.bio || "")}</textarea></label>
      <input id="avatar-input" class="sr-only" name="avatar" type="file" accept="${ALLOWED_IMAGE_TYPES.join(",")}">
      <input type="hidden" name="remove_avatar" value="">
      <div class="form-actions">
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`,
  );
}

function lightbox(src: string): void {
  modalRoot().innerHTML = `
    <div class="modal-backdrop lightbox" data-action="close-modal">
      <button class="icon-btn modal-close light" data-action="close-modal" aria-label="Close">${icon("x")}</button>
      <img src="${escapeHTML(src)}" alt="Full size image">
    </div>`;
  document.body.classList.add("modal-open");
}

/* ------------------------------------------------------------------ *
 *  Actions
 * ------------------------------------------------------------------ */

function postsWithId(id: number): Post[] {
  const all = [...state.feed, ...state.searchPosts];
  if (state.post) all.push(state.post);
  return all.filter((post) => post.id === id);
}

function syncPostUI(post: Post): void {
  document.querySelectorAll<HTMLElement>(`.post[data-post="${post.id}"] .vote-rail`).forEach((rail) => {
    rail.outerHTML = voteRail(post);
  });
}

async function vote(postId: number, value: number): Promise<void> {
  if (!state.user) {
    authModal("login");
    return;
  }

  const copies = postsWithId(postId);
  if (!copies.length) return;

  const before = { score: copies[0].score, myVote: copies[0].my_vote };
  const next = before.myVote === value ? 0 : value;

  const apply = (score: number, myVote: number) => {
    copies.forEach((copy) => {
      copy.score = score;
      copy.my_vote = myVote;
      syncPostUI(copy);
    });
  };

  apply(before.score - before.myVote + next, next); // optimistic

  try {
    const result = await api<{ my_vote: number; score: number }>(`/api/posts/${postId}/vote/`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
    apply(result.score, result.my_vote);
  } catch (error) {
    apply(before.score, before.myVote);
    toast(errorMessage(error, "Could not register your vote."), "error");
  }
}

async function toggleJoin(slug: string): Promise<void> {
  if (!state.user) {
    authModal("login");
    return;
  }

  const community = communityBySlug(slug);
  if (!community) return;

  try {
    if (community.is_member) {
      await api(`/api/communities/${encodeURIComponent(slug)}/leave/`, { method: "POST" });
      toast(`You left ${COMMUNITY_PREFIX}${community.name}.`);
    } else {
      const result = await api<{ status?: string; detail?: string }>(`/api/communities/${encodeURIComponent(slug)}/join/`, { method: "POST" });
      if (result.status === "pending") state.pending.add(slug);
      toast(result.detail || `You joined ${COMMUNITY_PREFIX}${community.name}.`);
    }

    await loadCommunities();

    if (state.route.name === "community" && state.route.slug === slug) {
      state.community = await api<Community>(`/api/communities/${encodeURIComponent(slug)}/`);
    }

    renderLeft();
    renderPage();
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

async function deletePost(postId: number): Promise<void> {
  if (!window.confirm("Delete this post? This can’t be undone.")) return;

  const community = state.post ? communityById(state.post.community) : undefined;

  try {
    await api(`/api/posts/${postId}/`, { method: "DELETE" });
    state.feed = state.feed.filter((post) => post.id !== postId);
    state.searchPosts = state.searchPosts.filter((post) => post.id !== postId);
    toast("Post deleted.");

    if (state.route.name === "post") {
      window.location.hash = community ? `#/c/${encodeURIComponent(community.slug)}` : "#/";
    } else {
      renderPage();
    }
  } catch (error) {
    toast(errorMessage(error, "Could not delete the post."), "error");
  }
}

async function sharePost(postId: number): Promise<void> {
  const url = `${window.location.origin}${window.location.pathname}#/post/${postId}`;

  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied to clipboard.");
  } catch {
    toast(url);
  }
}

function refreshComments(): void {
  const tree = document.querySelector<HTMLElement>("#comment-tree");
  if (tree) tree.innerHTML = commentTreeHTML();

  const title = document.querySelector<HTMLElement>("#comment-count-title");
  if (title) title.textContent = plural(state.comments.length, "Comment");

  if (state.post) {
    state.post.comment_count = state.comments.length;
    document.querySelectorAll<HTMLElement>(`[data-comment-count="${state.post.id}"]`).forEach((element) => {
      element.textContent = plural(state.comments.length, "Comment");
    });
  }

  document.querySelector<HTMLTextAreaElement>(".reply-form textarea")?.focus();
}

async function submitComment(form: HTMLFormElement, parent: number | null): Promise<void> {
  const post = state.post;
  if (!post) return;

  const textarea = form.querySelector<HTMLTextAreaElement>("textarea")!;
  const body = textarea.value.trim();
  if (!body) return;

  const created = await api<Comment>(`/api/posts/${post.id}/comments/`, {
    method: "POST",
    body: JSON.stringify({ body, parent }),
  });

  state.comments.push(created);
  state.replyTo = null;
  textarea.value = "";
  refreshComments();
  toast("Comment added.");
}

async function deleteComment(commentId: number): Promise<void> {
  const post = state.post;
  if (!post || !window.confirm("Delete this comment and its replies?")) return;

  try {
    await api(`/api/comments/${commentId}/`, { method: "DELETE" });
    state.comments = listOf(await api<ListResponse<Comment>>(`/api/posts/${post.id}/comments/`));
    refreshComments();
    toast("Comment deleted.");
  } catch (error) {
    toast(errorMessage(error, "Could not delete the comment."), "error");
  }
}

/* ---- submit page helpers ---- */

function renderPreviews(): void {
  const container = document.querySelector<HTMLElement>("#previews");
  if (!container) return;

  container.querySelectorAll("img").forEach((img) => URL.revokeObjectURL(img.src));

  container.innerHTML = state.submitFiles
    .map(
      (file, index) => `
    <div class="preview">
      <img src="${URL.createObjectURL(file)}" alt="Preview of ${escapeHTML(file.name)}">
      <button type="button" class="preview-remove" data-action="remove-image" data-index="${index}" aria-label="Remove ${escapeHTML(file.name)}">${icon("x")}</button>
    </div>`,
    )
    .join("");
}

function addFiles(files: File[]): void {
  for (const file of files) {
    if (state.submitFiles.length >= MAX_IMAGES) {
      toast(`You can attach up to ${MAX_IMAGES} images.`, "error");
      break;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast(`${file.name}: only JPEG, PNG and WEBP images are allowed.`, "error");
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`${file.name} is larger than 5 MB.`, "error");
      continue;
    }
    state.submitFiles.push(file);
  }

  renderPreviews();
}

function applySubmitKind(kind: "text" | "link"): void {
  state.submitKind = kind;

  const form = document.querySelector<HTMLFormElement>('form[data-form="submit"]');
  if (!form) return;

  form.dataset.kind = kind;
  form.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.kind === kind);
  });

  const body = form.querySelector<HTMLTextAreaElement>('[name="body"]');
  const url = form.querySelector<HTMLInputElement>('[name="link_url"]');
  if (body) body.required = kind === "text";
  if (url) url.required = kind === "link";
}

async function submitPost(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const kind = state.submitKind;

  const created = await api<Post>("/api/posts/", {
    method: "POST",
    body: JSON.stringify({
      community: Number(data.get("community")),
      post_type: kind,
      title: String(data.get("title") || "").trim(),
      body: kind === "text" ? String(data.get("body") || "") : "",
      link_url: kind === "link" ? String(data.get("link_url") || "").trim() : "",
    }),
  });

  if (state.submitFiles.length) {
    const upload = new FormData();
    state.submitFiles.forEach((file) => upload.append("images", file));

    try {
      await api(`/api/posts/${created.id}/images/`, { method: "POST", body: upload });
    } catch (error) {
      toast(`Your post was published, but the images failed: ${errorMessage(error)}`, "error");
    }
  }

  state.submitFiles = [];
  window.location.hash = `#/post/${created.id}`;
  toast("Your post is live!");
}

/* ---- forms ---- */

async function withBusy(form: HTMLFormElement, task: () => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button?.disabled) return;

  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }

  try {
    await task();
  } catch (error) {
    toast(errorMessage(error), "error");
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

async function handleSubmit(form: HTMLFormElement): Promise<void> {
  switch (form.dataset.form) {
    case "search": {
      const q = String(new FormData(form).get("q") || "").trim();
      if (q) window.location.hash = `#/search/${encodeURIComponent(q)}`;
      break;
    }

    case "auth":
      await withBusy(form, async () => {
        const mode = form.dataset.mode === "register" ? "register" : "login";
        const payload = Object.fromEntries(new FormData(form).entries());
        const result = await api<{ user: User }>(`/api/auth/${mode}/`, { method: "POST", body: JSON.stringify(payload) });

        state.user = result.user;
        closeModal();
        await loadCommunities();
        renderNav();
        await navigate({ keepScroll: true });
        toast(mode === "register" ? "Your account has been created!" : "Welcome back!");
      });
      break;

    case "community":
      await withBusy(form, async () => {
        const payload = Object.fromEntries(new FormData(form).entries());
        const created = await api<Community>("/api/communities/", { method: "POST", body: JSON.stringify(payload) });

        closeModal();
        await loadCommunities();
        renderLeft();
        window.location.hash = `#/c/${encodeURIComponent(created.slug)}`;
        toast(`${COMMUNITY_PREFIX}${created.name} is ready!`);
      });
      break;

    case "submit":
      await withBusy(form, () => submitPost(form));
      break;

    case "comment":
      await withBusy(form, () => submitComment(form, null));
      break;

    case "reply":
      await withBusy(form, () => submitComment(form, Number(form.dataset.parent) || null));
      break;

    case "profile":
      await withBusy(form, async () => {
        const data = new FormData(form);
        const upload = new FormData();
        upload.append("display_name", String(data.get("display_name") || "").trim());
        upload.append("bio", String(data.get("bio") || "").trim());

        const avatar = data.get("avatar");
        if (avatar instanceof File && avatar.size) upload.append("avatar", avatar);
        else if (data.get("remove_avatar") === "1") upload.append("remove_avatar", "true");

        const result = await api<{ user: User }>("/api/auth/me/", { method: "PATCH", body: upload });
        state.user = result.user;
        closeModal();
        renderNav();
        await navigate({ keepScroll: true });
        toast("Profile updated.");
      });
      break;

    case "branding":
      await withBusy(form, async () => {
        const data = new FormData(form);
        const upload = new FormData();
        upload.append("site_name", String(data.get("site_name") || ""));
        upload.append("tagline", String(data.get("tagline") || ""));

        const logo = data.get("logo");
        const appIcon = data.get("app_icon");
        if (logo instanceof File && logo.size) upload.append("logo", logo);
        if (appIcon instanceof File && appIcon.size) upload.append("app_icon", appIcon);

        state.branding = { ...state.branding, ...(await api<Branding>("/api/branding/", { method: "PATCH", body: upload })) };
        applyBranding();
        renderNav();
        renderLeft();
        renderPage();
        updateTitle();
        toast("Branding updated.");
      });
      break;
  }
}

/* ------------------------------------------------------------------ *
 *  Event delegation
 * ------------------------------------------------------------------ */

function closeMenus(): void {
  document.querySelectorAll(".menu-wrap.open").forEach((wrap) => {
    wrap.classList.remove("open");
    wrap.querySelector(".user-btn")?.setAttribute("aria-expanded", "false");
  });
}

async function handleAction(element: HTMLElement, event: Event): Promise<void> {
  const action = element.dataset.action;
  const id = Number(element.dataset.id);

  switch (action) {
    case "toggle-drawer":
      document.body.classList.toggle("drawer-open");
      break;
    case "close-drawer":
      document.body.classList.remove("drawer-open");
      break;
    case "toggle-menu": {
      const wrap = element.closest(".menu-wrap");
      const open = !wrap?.classList.contains("open");
      closeMenus();
      if (wrap && open) {
        wrap.classList.add("open");
        element.setAttribute("aria-expanded", "true");
      }
      break;
    }
    case "toggle-theme":
      setPrefs({ mode: currentTheme() === "dark" ? "light" : "dark" });
      break;
    case "open-appearance":
      appearanceModal();
      break;
    case "set-mode":
      setPrefs({ mode: (element.dataset.value as Mode) || "system" });
      appearanceModal();
      break;
    case "set-accent":
      setPrefs({ accent: element.dataset.value || "default" });
      appearanceModal();
      break;
    case "set-density":
      setPrefs({ density: element.dataset.value === "compact" ? "compact" : "card" });
      appearanceModal();
      break;
    case "reset-appearance":
      setPrefs({ ...DEFAULT_PREFS });
      appearanceModal();
      break;
    case "edit-profile":
      closeMenus();
      profileModal();
      break;
    case "remove-avatar": {
      const form = element.closest("form");
      const user = state.user;
      if (!form || !user) break;
      form.querySelector<HTMLInputElement>("#avatar-input")!.value = "";
      form.querySelector<HTMLInputElement>('input[name="remove_avatar"]')!.value = "1";
      form.querySelector("#avatar-preview")!.innerHTML = userAvatar(userName(user), "lg");
      break;
    }
    case "open-login":
      authModal("login");
      break;
    case "open-register":
      authModal("register");
      break;
    case "logout":
      await api("/api/auth/logout/", { method: "POST" });
      state.user = null;
      await loadCommunities();
      renderNav();
      await navigate();
      toast("You have been logged out.");
      break;
    case "close-modal":
      /* clicking the dark backdrop closes, clicking inside the dialog does not */
      if (element.classList.contains("modal-backdrop") && event.target !== element) break;
      closeModal();
      break;
    case "sort":
      if (element.dataset.sort && element.dataset.sort !== state.sort) {
        state.sort = element.dataset.sort as Sort;
        await navigate({ keepScroll: true });
      }
      break;
    case "vote":
      await vote(id, Number(element.dataset.value));
      break;
    case "share":
      await sharePost(id);
      break;
    case "delete-post":
      await deletePost(id);
      break;
    case "toggle-join":
      await toggleJoin(element.dataset.slug || "");
      break;
    case "create-community":
      communityModal();
      break;
    case "submit-kind":
      applySubmitKind(element.dataset.kind === "link" ? "link" : "text");
      break;
    case "remove-image":
      state.submitFiles.splice(Number(element.dataset.index), 1);
      renderPreviews();
      break;
    case "lightbox":
      lightbox(element.dataset.src || "");
      break;
    case "toggle-comment":
      if (state.collapsed.has(id)) state.collapsed.delete(id);
      else state.collapsed.add(id);
      refreshComments();
      break;
    case "reply": {
      if (!state.user) {
        authModal("login");
        break;
      }
      const community = state.post ? communityById(state.post.community) : undefined;
      if (community && !community.is_member) {
        toast(`Join ${COMMUNITY_PREFIX}${community.name} to reply.`, "error");
        break;
      }
      state.replyTo = state.replyTo === id ? null : id;
      refreshComments();
      break;
    }
    case "cancel-reply":
      state.replyTo = null;
      refreshComments();
      break;
    case "delete-comment":
      await deleteComment(id);
      break;
    case "back":
      if (window.history.length > 1) window.history.back();
      else window.location.hash = "#/";
      break;
    case "retry":
      await navigate({ keepScroll: true });
      break;
  }
}

function setupEvents(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (!target.closest(".menu-wrap")) closeMenus();

    let actionEl = target.closest<HTMLElement>("[data-action]");
    /* the dark backdrop only reacts to clicks on itself, never to clicks inside the dialog */
    if (actionEl?.classList.contains("modal-backdrop") && target !== actionEl) actionEl = null;
    if (actionEl) {
      event.preventDefault();
      handleAction(actionEl, event).catch((error) => toast(errorMessage(error), "error"));
      return;
    }

    /* clicking a link to the page you are already on refreshes it */
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#/"]');
    if (anchor && anchor.getAttribute("href") === window.location.hash) {
      event.preventDefault();
      navigate({ keepScroll: true });
      return;
    }

    /* the whole post card is clickable in feeds */
    const card = target.closest<HTMLElement>(".post-clickable");
    if (card && !target.closest("a, button, input, textarea, select, label, form")) {
      const href = card.dataset.href;
      if (href && !window.getSelection()?.toString()) window.location.hash = href;
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.dataset.form) return;

    event.preventDefault();
    handleSubmit(form).catch((error) => toast(errorMessage(error), "error"));
  });

  document.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "post-images" && input.files) {
      addFiles(Array.from(input.files));
      input.value = "";
    }

    if (input.id === "avatar-input") {
      const file = input.files?.[0];
      const form = input.closest("form");
      if (!file || !form) return;

      if (!ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) {
        toast("Please choose a JPEG, PNG or WEBP image under 5 MB.", "error");
        input.value = "";
        return;
      }

      form.querySelector<HTMLInputElement>('input[name="remove_avatar"]')!.value = "";
      const preview = form.querySelector("#avatar-preview")!;
      preview.querySelector("img")?.remove();
      preview.innerHTML = `<img class="avatar lg" src="${URL.createObjectURL(file)}" alt="New profile picture preview">`;
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === "title" && input.closest('form[data-form="submit"]')) {
      const counter = document.querySelector<HTMLElement>("#title-count");
      if (counter) counter.textContent = `${input.value.length}/180`;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenus();
      document.body.classList.remove("drawer-open");
      if (document.body.classList.contains("modal-open")) closeModal();
    }
  });

  window.addEventListener("hashchange", () => {
    navigate();
  });
}

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  prefs = loadPrefs();
  applyAppearance();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (prefs.mode === "system") {
      applyAppearance();
      renderNav();
    }
  });

  renderChrome();
  setupEvents();

  state.route = parseRoute(window.location.hash);
  renderNav();
  renderLeft();
  renderPage();

  await Promise.allSettled([loadUser(), loadBranding()]);
  await loadCommunities();

  await navigate({ keepScroll: true });
}

boot();
