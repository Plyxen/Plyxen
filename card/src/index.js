// Spotify "now playing" card for the GitHub profile README.
//
// Reads the Spotify part of a Discord presence from Lanyard (games are ignored)
// and returns an SVG whose progress bar and elapsed time keep moving while the
// page is open. When nothing is playing it shows the last track it saw, if a
// CARD_KV namespace is bound.

const W = 460;
const H = 152;
const PAD = 16;
const COVER = 120;
const TEXT_X = PAD + COVER + 18;
const BAR_W = W - TEXT_X - PAD;
const BAR_Y = 112;
const MAX_TICKS = 900; // stop ticking the clock after 15 minutes on one page load

const GREEN = "#1DB954";
const BG = "#181818";
const MUTED = "#b3b3b3";

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname !== "/") return new Response("Not found", { status: 404 });

    let track = null;
    let playing = false;
    try {
      const res = await fetch(`https://api.lanyard.rest/v1/users/${env.DISCORD_ID}`);
      const body = await res.json();
      if (body.success && body.data.listening_to_spotify && body.data.spotify) {
        track = body.data.spotify;
        playing = true;
      }
    } catch {
      // Lanyard down: fall through to the last track or the idle card
    }

    if (env.CARD_KV) {
      if (playing) {
        const last = await env.CARD_KV.get("last", "json");
        if (!last || last.track_id !== track.track_id) {
          ctx.waitUntil(env.CARD_KV.put("last", JSON.stringify(track)));
        }
      } else {
        track = await env.CARD_KV.get("last", "json");
      }
    }

    const cover = track ? await fetchCover(track.album_art_url) : null;
    return new Response(render(track, playing, cover, Date.now()), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
      },
    });
  },
};

// GitHub shows README images through a proxy that blocks external requests from
// inside an SVG, so the cover has to be inlined. 300px is plenty for 120px.
async function fetchCover(url) {
  if (!url) return null;
  try {
    const res = await fetch(url.replace("ab67616d0000b273", "ab67616d00001e02"));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${res.headers.get("content-type") || "image/jpeg"};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

function render(track, playing, cover, now) {
  const title = track ? clip(track.song, 26) : "Not listening to anything";
  const artist = track ? clip(track.artist.replaceAll(";", ","), 40) : "Spotify";
  const label = playing ? "NOW PLAYING" : track ? "RECENTLY PLAYED" : "OFFLINE";

  const coverEl = cover
    ? `<image href="${cover}" x="${PAD}" y="${PAD}" width="${COVER}" height="${COVER}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/>`
    : `<rect x="${PAD}" y="${PAD}" width="${COVER}" height="${COVER}" rx="6" fill="#282828"/>
  <path d="M82 52v38a10 10 0 1 1-6-9V58l22-5v29a10 10 0 1 1-6-9V47z" fill="#535353"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label}: ${title} by ${artist}`)}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}</style>
  <defs><clipPath id="cover"><rect x="${PAD}" y="${PAD}" width="${COVER}" height="${COVER}" rx="6"/></clipPath></defs>
  <rect width="${W}" height="${H}" rx="12" fill="${BG}"/>
  ${coverEl}
  <text x="${TEXT_X}" y="46" font-size="18" font-weight="700" fill="#fff">${esc(title)}</text>
  <text x="${TEXT_X}" y="68" font-size="13" fill="${MUTED}">${esc(artist)}</text>
  <g transform="translate(${TEXT_X} 82)">
    <circle cx="8" cy="8" r="8" fill="${playing ? GREEN : MUTED}"/>
    <path d="M4 6.2c2.8-.9 5.8-.6 8.2.8M4.5 8.6c2.3-.7 4.7-.4 6.7.7M5 10.9c1.8-.5 3.6-.3 5.1.5" stroke="${BG}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  </g>
  <text x="${TEXT_X + 22}" y="94" font-size="11" font-weight="700" letter-spacing="1" fill="${playing ? GREEN : MUTED}">${label}</text>
  ${playing ? progress(track.timestamps, now) : ""}
</svg>`;
}

// The bar animates from where the song is now to the end, and the elapsed time
// is one <text> per second, each shown for one second.
function progress({ start, end }, now) {
  const duration = Math.max(end - start, 1000);
  const elapsed = Math.min(Math.max(now - start, 0), duration);
  const remaining = (duration - elapsed) / 1000;
  const startW = ((BAR_W * elapsed) / duration).toFixed(2);

  const s0 = Math.floor(elapsed / 1000);
  const ticks = Math.min(Math.floor(duration / 1000) - s0, MAX_TICKS);
  const first = (1000 - (elapsed % 1000)) / 1000; // seconds until the clock first changes
  const clock = [];
  for (let k = 0; k <= ticks; k++) {
    const show = k === 0 ? "" : `<set attributeName="visibility" to="visible" begin="${(first + k - 1).toFixed(3)}s"/>`;
    const hide = k === ticks ? "" : `<set attributeName="visibility" to="hidden" begin="${(first + k).toFixed(3)}s"/>`;
    clock.push(`<text x="${TEXT_X}" y="136" visibility="${k === 0 ? "visible" : "hidden"}">${fmt(s0 + k)}${show}${hide}</text>`);
  }

  return `<rect x="${TEXT_X}" y="${BAR_Y}" width="${BAR_W}" height="4" rx="2" fill="#4d4d4d"/>
  <rect x="${TEXT_X}" y="${BAR_Y}" width="${startW}" height="4" rx="2" fill="${GREEN}">
    <animate attributeName="width" from="${startW}" to="${BAR_W}" dur="${remaining.toFixed(3)}s" fill="freeze"/>
  </rect>
  <g font-size="11" fill="${MUTED}">
    ${clock.join("\n    ")}
    <text x="${W - PAD}" y="136" text-anchor="end">${fmt(Math.round(duration / 1000))}</text>
  </g>`;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function clip(text, max) {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

function esc(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
