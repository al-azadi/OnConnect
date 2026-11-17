/* ------------------------------------------------------------------ *
 *  Types and pure helpers (no DOM access, so they are easy to test)
 * ------------------------------------------------------------------ */

export type User = {
  id: number;
  username: string;
  email: string;
  display_name: string;
  bio?: string;
  avatar_url?: string;
  is_staff?: boolean;
  date_joined?: string;
};

export type Community = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  rules?: string;
  visibility?: string;
  image_url?: string;
  owner?: number;
  owner_name?: string;
  member_limit?: number | null;
  member_count?: number;
  my_role?: string | null;
  is_member?: boolean;
  created_at?: string;
};

export type PostImage = {
  id: number;
  image_url: string;
  caption?: string;
};

export type Post = {
  id: number;
  community: number;
  community_name: string;
  author: number;
  author_name: string;
  username: string;
  author_avatar?: string;
  title: string;
  body: string;
  post_type: "text" | "link";
  link_url?: string;
  score: number;
  comment_count: number;
  my_vote: number;
  images: PostImage[];
  created_at: string;
};

export type Comment = {
  id: number;
  post: number;
  author: number;
  author_name: string;
  username: string;
  author_avatar?: string;
  parent: number | null;
  body: string;
  created_at: string;
};

export type CommentNode = Comment & { children: CommentNode[] };

export type Branding = {
  site_name: string;
  tagline: string;
  logo_url: string | null;
  app_icon_url: string | null;
};

export type Sort = "hot" | "new" | "top";

export type Route =
  | { name: "home" }
  | { name: "popular" }
  | { name: "communities" }
  | { name: "community"; slug: string }
  | { name: "post"; id: number }
  | { name: "submit"; slug?: string }
  | { name: "search"; q: string }
  | { name: "user"; username: string }
  | { name: "settings" }
  | { name: "notfound" };

/* ------------------------------ Routing ----------------------------- */

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Turns a location hash such as "#/c/ai-lab" into a Route object. */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = path.split("/").slice(1).map(decode);
  const [first = "", second = ""] = parts;

  switch (first) {
    case "":
      return { name: "home" };
    case "popular":
      return { name: "popular" };
    case "communities":
      return { name: "communities" };
    case "settings":
      return { name: "settings" };
    case "c":
      return second ? { name: "community", slug: second } : { name: "communities" };
    case "u":
      return second ? { name: "user", username: second } : { name: "notfound" };
    case "search":
      return { name: "search", q: second };
    case "submit":
      return second ? { name: "submit", slug: second } : { name: "submit" };
    case "post": {
      const id = Number(second);
      return Number.isInteger(id) && id > 0 ? { name: "post", id } : { name: "notfound" };
    }
    default:
      return { name: "notfound" };
  }
}

/* ----------------------------- Formatting --------------------------- */

export function escapeHTML(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

/** Only allows http(s) URLs so a "javascript:" link can never be rendered. */
export function safeUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, "http://placeholder.invalid");
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Reddit-style relative time: "5 min. ago", "3 hr. ago", "2 days ago". */
export function timeAgo(date: string, now: number = Date.now()): string {
  const seconds = Math.floor((now - new Date(date).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min. ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr. ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo. ago`;

  return `${Math.floor(days / 365)} yr. ago`;
}

/** 1234 -> "1.2k", 15200 -> "15k" */
export function formatCount(value: number): string {
  const n = Number(value) || 0;
  const abs = Math.abs(n);

  if (abs < 1000) return String(n);
  if (abs < 1_000_000) {
    const k = n / 1000;
    return `${abs >= 10_000 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  return letters || "?";
}

/** Deterministic hue (0-359) so every community/user keeps the same colour. */
export function hueFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/* ------------------------------ Sorting ----------------------------- */

/** Score with a time decay so fresh, active posts float to the top. */
export function hotScore(post: Post, now: number = Date.now()): number {
  const ageHours = Math.max(0, (now - new Date(post.created_at).getTime()) / 3_600_000);
  const points = (post.score || 0) + 1 + (post.comment_count || 0) * 0.5;
  return points / Math.pow(ageHours + 2, 1.5);
}

export function sortPosts(posts: Post[], sort: Sort, now: number = Date.now()): Post[] {
  const copy = [...posts];

  if (sort === "hot") {
    return copy.sort((a, b) => hotScore(b, now) - hotScore(a, now));
  }
  if (sort === "top") {
    return copy.sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at));
  }
  return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/* ----------------------------- Comments ----------------------------- */

/** Turns the flat comment list from the API into a reply tree. */
export function buildCommentTree(items: Comment[]): CommentNode[] {
  const nodes = new Map<number, CommentNode>();
  items.forEach((item) => nodes.set(item.id, { ...item, children: [] }));

  const roots: CommentNode[] = [];

  nodes.forEach((node) => {
    const parent = node.parent !== null ? nodes.get(node.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  return roots;
}

export function countDescendants(node: CommentNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}
