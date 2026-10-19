// Run: node --test tests/providers.test.mjs
// Live network checks: PROVIDERS_LIVE=1 node --test tests/providers.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ProviderError,
  SearchIncompleteError,
  resolveCandidate,
  searchCandidates
} from "../providers.js";

const CINEMETA = "https://v3-cinemeta.strem.io";
const IMDB = "https://v3.sg.media-imdb.com/suggestion/titles/x";
const TVMAZE = "https://api.tvmaze.com";

// Fixtures trimmed from real responses captured on 2026-10-19.
const fixtures = {
  cinemetaDarkSeries: {
    query: "dark",
    metas: [
      { id: "tt19231492", imdb_id: "tt19231492", type: "series", name: "Dark Matter", releaseInfo: "2024-" },
      { id: "tt5753856", imdb_id: "tt5753856", type: "series", name: "Dark", releaseInfo: "2017-2020" },
      { id: "tt1319636", imdb_id: "tt1319636", type: "series", name: "Dark Blue", releaseInfo: "2009–2010", year: "2009–2010" },
      { id: "tt40387887", imdb_id: "tt40387887", type: "series", name: "Dark Untitled" }
    ]
  },
  cinemetaInceptionMovie: {
    query: "inception",
    metas: [
      { id: "tt1375666", imdb_id: "tt1375666", type: "movie", name: "Inception", releaseInfo: "2010" },
      { id: "tt8269586", imdb_id: "tt8269586", type: "movie", name: "Bikini Inception", releaseInfo: "2015" },
      { id: "tt7808620", imdb_id: "tt7808620", type: "movie", name: "#DUPE#", releaseInfo: "2017" },
      { id: "kitsu:1", type: "movie", name: "Not an IMDb id" },
      { id: "tt0000001", imdb_id: "tt0000001", type: "series", name: "Wrong type" }
    ]
  },
  imdbSquidGame: {
    q: "鱿鱼游戏",
    v: 1,
    d: [
      { id: "tt10919420", qid: "tvSeries", l: "Squid Game", y: 2021, yr: "2021-2025", s: "Lee Jung-jae" },
      { id: "tt28104766", qid: "tvSeries", l: "Squid Game: The Challenge", y: 2023 },
      { id: "tt11111111", qid: "short", l: "Squid Game short", y: 2022 },
      { id: "tt12078990", qid: "tvMovie", l: "Money Heist: The Phenomenon", y: 2020 },
      { id: "tt15523010", qid: "tvSpecial", l: "Dave Chappelle: The Closer", y: 2021 },
      { id: "nm0000001", qid: "", l: "A Person" }
    ]
  },
  metaInception: {
    meta: {
      id: "tt1375666", imdb_id: "tt1375666", type: "movie", name: "Inception",
      year: "2010", releaseInfo: "2010", imdbRating: "8.8"
    }
  },
  metaDark: {
    meta: {
      id: "tt5753856", imdb_id: "tt5753856", type: "series", name: "Dark",
      year: "2017–2020", releaseInfo: "2017–2020", imdbRating: "8.7"
    }
  },
  tvmazeDark: {
    id: 17861, url: "https://www.tvmaze.com/shows/17861/dark", name: "Dark", premiered: "2017-12-01",
    rating: { average: 8.2 }, externals: { tvrage: null, thetvdb: 334824, imdb: "tt5753856" }
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function text(body, status) {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

// Routes map a URL (or a predicate) to a Response, a function returning one,
// or an array consumed in order (to script retries).
function fakeFetch(routes) {
  const calls = [];
  const queues = new Map();
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    const key = Object.keys(routes).find((route) => route === url);
    if (key === undefined) throw new Error(`Unexpected request: ${url}`);
    let handler = routes[key];
    if (Array.isArray(handler)) {
      if (!queues.has(key)) queues.set(key, [...handler]);
      handler = queues.get(key).shift();
    }
    return typeof handler === "function" ? handler(url, init) : handler.clone();
  };
  return { fetchImpl, calls };
}

function hang(url, { signal }) {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

const cinemetaSearch = (type, encoded) => `${CINEMETA}/catalog/${type}/top/search=${encoded}.json`;

describe("searchCandidates", () => {
  it("builds encoded Cinemeta URLs for both types and collapses whitespace", async () => {
    const encoded = "Love%2C%20Death%20%26%20Robots";
    const { fetchImpl, calls } = fakeFetch({
      [cinemetaSearch("movie", encoded)]: json({ metas: [] }),
      [cinemetaSearch("series", encoded)]: json({
        metas: [{ id: "tt9561862", imdb_id: "tt9561862", type: "series", name: "Love, Death & Robots", releaseInfo: "2019-" }]
      })
    });
    const result = await searchCandidates("  Love,  Death & Robots ", { fetchImpl });
    assert.deepEqual(calls.sort(), [cinemetaSearch("movie", encoded), cinemetaSearch("series", encoded)].sort());
    assert.deepEqual(result, [{
      id: "tt9561862", title: "Love, Death & Robots", year: 2019, type: "series",
      provider: "Cinemeta", url: "https://www.imdb.com/title/tt9561862/", rank: 0
    }]);
  });

  it("keeps provider order instead of picking the first or best-looking hit", async () => {
    const { fetchImpl, calls } = fakeFetch({
      [cinemetaSearch("series", "dark")]: json(fixtures.cinemetaDarkSeries)
    });
    const result = await searchCandidates("dark", { type: "series", fetchImpl });
    assert.equal(calls.length, 1);
    assert.deepEqual(result.map((c) => [c.id, c.title, c.year, c.rank]), [
      ["tt19231492", "Dark Matter", 2024, 0],
      ["tt5753856", "Dark", 2017, 1],
      ["tt1319636", "Dark Blue", 2009, 2],
      ["tt40387887", "Dark Untitled", null, 3]
    ]);
  });

  it("drops #DUPE# placeholders, non-IMDb ids and wrong-type entries", async () => {
    const { fetchImpl } = fakeFetch({
      [cinemetaSearch("movie", "inception")]: json(fixtures.cinemetaInceptionMovie)
    });
    const result = await searchCandidates("inception", { type: "movie", fetchImpl });
    assert.deepEqual(result.map((c) => c.id), ["tt1375666", "tt8269586"]);
  });

  it("asks IMDb suggestions first for CJK titles and maps IMDb kinds to types", async () => {
    const { fetchImpl, calls } = fakeFetch({
      [`${IMDB}/%E9%B1%BF%E9%B1%BC%E6%B8%B8%E6%88%8F.json`]: json(fixtures.imdbSquidGame)
    });
    const result = await searchCandidates("鱿鱼游戏", { fetchImpl });
    assert.deepEqual(calls, [`${IMDB}/%E9%B1%BF%E9%B1%BC%E6%B8%B8%E6%88%8F.json`]);
    assert.deepEqual(result.map((c) => [c.id, c.type, c.year, c.provider, c.rank]), [
      ["tt10919420", "series", 2021, "IMDb", 0],
      ["tt28104766", "series", 2023, "IMDb", 1],
      ["tt12078990", "movie", 2020, "IMDb", 3],
      ["tt15523010", "movie", 2021, "IMDb", 4]
    ]);
  });

  it("filters IMDb suggestions by the requested type", async () => {
    const { fetchImpl } = fakeFetch({
      [`${IMDB}/%E9%B1%BF%E9%B1%BC%E6%B8%B8%E6%88%8F.json`]: json(fixtures.imdbSquidGame)
    });
    const result = await searchCandidates("鱿鱼游戏", { type: "series", fetchImpl });
    assert.deepEqual(result.map((c) => c.id), ["tt10919420", "tt28104766"]);
  });

  it("falls back to IMDb suggestions when Cinemeta finds nothing", async () => {
    const { fetchImpl, calls } = fakeFetch({
      [cinemetaSearch("movie", "the%20closer")]: json({ metas: [] }),
      [`${IMDB}/the%20closer.json`]: json({ d: [{ id: "tt0101596", qid: "movie", l: "The Closer", y: 1990 }] })
    });
    const result = await searchCandidates("the closer", { type: "movie", fetchImpl });
    assert.equal(calls.length, 2);
    assert.deepEqual(result.map((c) => [c.id, c.provider]), [["tt0101596", "IMDb"]]);
  });

  it("widens recall with IMDb only when no candidate is within ±1 of the year, deduplicating ids", async () => {
    const routes = {
      [cinemetaSearch("movie", "rebecca")]: json({
        metas: [{ id: "tt0032976", imdb_id: "tt0032976", type: "movie", name: "Rebecca", releaseInfo: "1940" }]
      }),
      [`${IMDB}/rebecca.json`]: json({
        d: [
          { id: "tt2235695", qid: "movie", l: "Rebecca", y: 2020 },
          { id: "tt0032976", qid: "movie", l: "Rebecca", y: 1940 }
        ]
      })
    };
    const missed = fakeFetch(routes);
    const widened = await searchCandidates("rebecca", { type: "movie", year: 2020, fetchImpl: missed.fetchImpl });
    assert.deepEqual(widened.map((c) => [c.id, c.year, c.provider]), [
      ["tt0032976", 1940, "Cinemeta"],
      ["tt2235695", 2020, "IMDb"]
    ]);

    const covered = fakeFetch(routes);
    await searchCandidates("rebecca", { type: "movie", year: 1941, fetchImpl: covered.fetchImpl });
    assert.equal(covered.calls.length, 1, "year within ±1 needs no second provider");
  });

  it("retries one transient Cinemeta 504", async () => {
    const url = cinemetaSearch("movie", "inception");
    const { fetchImpl, calls } = fakeFetch({
      [url]: [text("error code: 504", 504), json(fixtures.cinemetaInceptionMovie)]
    });
    const result = await searchCandidates("inception", { type: "movie", fetchImpl });
    assert.equal(calls.length, 2);
    assert.equal(result[0].id, "tt1375666");
  });

  it("honours Retry-After on 429", async () => {
    const url = cinemetaSearch("movie", "inception");
    const { fetchImpl, calls } = fakeFetch({
      [url]: [json({}, 429, { "retry-after": "0" }), json(fixtures.cinemetaInceptionMovie)]
    });
    const result = await searchCandidates("inception", { type: "movie", fetchImpl });
    assert.equal(calls.length, 2);
    assert.equal(result.length, 2);
  });

  it("does not retry non-transient HTTP errors", async () => {
    const { fetchImpl, calls } = fakeFetch({
      [cinemetaSearch("movie", "inception")]: text("bad", 400),
      [`${IMDB}/inception.json`]: json({ d: [] })
    });
    assert.deepEqual(await searchCandidates("inception", { type: "movie", fetchImpl }), []);
    assert.equal(calls.length, 2, "one Cinemeta attempt, then the IMDb step");
  });

  it("uses the other provider when the first one keeps failing", async () => {
    const { fetchImpl } = fakeFetch({
      [cinemetaSearch("movie", "inception")]: text("error code: 504", 504),
      [`${IMDB}/inception.json`]: json({ d: [{ id: "tt1375666", qid: "movie", l: "Inception", y: 2010 }] })
    });
    const result = await searchCandidates("inception", { type: "movie", fetchImpl });
    assert.deepEqual(result.map((c) => [c.id, c.provider]), [["tt1375666", "IMDb"]]);
  });

  it("throws SearchIncompleteError instead of returning a misleading empty list", async () => {
    const { fetchImpl } = fakeFetch({
      [cinemetaSearch("movie", "inception")]: text("error code: 504", 504),
      [`${IMDB}/inception.json`]: () => { throw new TypeError("fetch failed"); }
    });
    await assert.rejects(searchCandidates("inception", { type: "movie", fetchImpl }), (error) => {
      assert.ok(error instanceof SearchIncompleteError);
      assert.deepEqual(error.candidates, []);
      assert.deepEqual(error.failures.map((f) => [f.provider, f.kind, f.status]), [
        ["Cinemeta", "http", 504],
        ["IMDb", "network", null]
      ]);
      return true;
    });
  });

  it("times out hung requests and reports them as timeouts", async () => {
    const { fetchImpl, calls } = fakeFetch({
      [cinemetaSearch("movie", "inception")]: hang,
      [`${IMDB}/inception.json`]: hang
    });
    await assert.rejects(searchCandidates("inception", { type: "movie", fetchImpl, timeoutMs: 30 }), (error) => {
      assert.ok(error.failures.every((f) => f instanceof ProviderError && f.kind === "timeout"));
      return true;
    });
    assert.equal(calls.length, 4, "each provider is tried twice");
  });

  it("validates input and skips requests for blank queries", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    assert.deepEqual(await searchCandidates("   ", { fetchImpl }), []);
    assert.equal(calls.length, 0);
    await assert.rejects(searchCandidates("x", { type: "tv", fetchImpl }), TypeError);
    await assert.rejects(searchCandidates("x", { year: "2020", fetchImpl }), TypeError);
    await assert.rejects(searchCandidates(null, { fetchImpl }), TypeError);
  });
});

describe("resolveCandidate", () => {
  const inception = { id: "tt1375666", title: "Inception", year: 2010, type: "movie", provider: "Cinemeta" };
  const dark = { id: "tt5753856", title: "Dark", year: 2017, type: "series", provider: "Cinemeta" };
  const metaUrl = (type, id) => `${CINEMETA}/meta/${type}/${id}.json`;
  const tvmazeUrl = (id) => `${TVMAZE}/lookup/shows?imdb=${id}`;

  it("returns the Cinemeta-mirrored IMDb rating for a movie without asking TVmaze", async () => {
    const { fetchImpl, calls } = fakeFetch({ [metaUrl("movie", "tt1375666")]: json(fixtures.metaInception) });
    const result = await resolveCandidate(inception, { fetchImpl });
    assert.deepEqual(calls, [metaUrl("movie", "tt1375666")]);
    assert.deepEqual(result, {
      id: "tt1375666",
      title: "Inception",
      year: 2010,
      type: "movie",
      ratings: { imdb: { value: 8.8, scale: 10, provider: "Cinemeta", url: "https://www.imdb.com/title/tt1375666/" } },
      sources: [{ provider: "Cinemeta", url: metaUrl("movie", "tt1375666"), status: "ok" }]
    });
  });

  it("keeps TVmaze's own rating separate from the IMDb rating for a series", async () => {
    const { fetchImpl } = fakeFetch({
      [metaUrl("series", "tt5753856")]: json(fixtures.metaDark),
      [tvmazeUrl("tt5753856")]: json(fixtures.tvmazeDark)
    });
    const result = await resolveCandidate(dark, { fetchImpl });
    assert.deepEqual(result.ratings, {
      imdb: { value: 8.7, scale: 10, provider: "Cinemeta", url: "https://www.imdb.com/title/tt5753856/" },
      tvmaze: { value: 8.2, scale: 10, provider: "TVmaze", url: "https://www.tvmaze.com/shows/17861/dark" }
    });
    assert.deepEqual(result.sources.map((s) => [s.provider, s.status]), [["Cinemeta", "ok"], ["TVmaze", "ok"]]);
  });

  it("never presents a TVmaze rating as IMDb when Cinemeta fails", async () => {
    const { fetchImpl } = fakeFetch({
      [metaUrl("series", "tt5753856")]: text("error code: 504", 504),
      [tvmazeUrl("tt5753856")]: json(fixtures.tvmazeDark)
    });
    const result = await resolveCandidate(dark, { fetchImpl });
    assert.equal(result.ratings.imdb, undefined);
    assert.equal(result.ratings.tvmaze.provider, "TVmaze");
    assert.deepEqual(result.sources.map((s) => [s.provider, s.status]), [["Cinemeta", "error"], ["TVmaze", "ok"]]);
    assert.match(result.sources[0].error, /HTTP 504/);
    assert.equal(result.title, "Dark", "falls back to TVmaze for title/year");
    assert.equal(result.year, 2017);
  });

  it("reports not_found for an empty Cinemeta meta and a TVmaze 404", async () => {
    const { fetchImpl } = fakeFetch({
      [metaUrl("series", "tt5753856")]: json({}),
      [tvmazeUrl("tt5753856")]: new Response(null, { status: 404 })
    });
    const result = await resolveCandidate(dark, { fetchImpl });
    assert.deepEqual(result.ratings, {});
    assert.deepEqual(result.sources.map((s) => s.status), ["not_found", "not_found"]);
    assert.equal(result.title, "Dark", "falls back to the candidate's own fields");
  });

  it("reports no_rating instead of inventing a value", async () => {
    const { fetchImpl } = fakeFetch({
      [metaUrl("series", "tt5753856")]: json({ meta: { ...fixtures.metaDark.meta, imdbRating: "" } }),
      [tvmazeUrl("tt5753856")]: json({ ...fixtures.tvmazeDark, rating: { average: null } })
    });
    const result = await resolveCandidate(dark, { fetchImpl });
    assert.deepEqual(result.ratings, {});
    assert.deepEqual(result.sources.map((s) => s.status), ["no_rating", "no_rating"]);
  });

  it("ignores responses that describe a different IMDb id", async () => {
    const { fetchImpl } = fakeFetch({
      [metaUrl("series", "tt5753856")]: json({ meta: { ...fixtures.metaDark.meta, id: "tt0000002", imdb_id: "tt0000002" } }),
      [tvmazeUrl("tt5753856")]: json({ ...fixtures.tvmazeDark, externals: { imdb: "tt0000002" } })
    });
    const result = await resolveCandidate(dark, { fetchImpl });
    assert.deepEqual(result.ratings, {});
    assert.deepEqual(result.sources.map((s) => s.status), ["not_found", "not_found"]);
  });

  it("rejects malformed candidates", async () => {
    await assert.rejects(resolveCandidate({ id: "12345", type: "movie" }), TypeError);
    await assert.rejects(resolveCandidate({ id: "tt1375666", type: "episode" }), TypeError);
    await assert.rejects(resolveCandidate(null), TypeError);
  });
});

describe("rate limiting", () => {
  it("spaces TVmaze requests at least 500 ms apart", async () => {
    const starts = [];
    const ids = ["tt0000101", "tt0000102", "tt0000103"];
    const routes = {};
    for (const id of ids) {
      routes[`${CINEMETA}/meta/series/${id}.json`] = json({});
      routes[`${TVMAZE}/lookup/shows?imdb=${id}`] = () => {
        starts.push(Date.now());
        return new Response(null, { status: 404 });
      };
    }
    const { fetchImpl } = fakeFetch(routes);
    await Promise.all(ids.map((id) => resolveCandidate({ id, type: "series" }, { fetchImpl })));
    assert.equal(starts.length, 3);
    for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 490, `gap ${starts[i] - starts[i - 1]} ms`);
  });

  it("caps concurrent Cinemeta requests at 4", async () => {
    let active = 0;
    let peak = 0;
    const routes = {};
    const ids = Array.from({ length: 8 }, (_, i) => `tt00002${String(i).padStart(2, "0")}`);
    for (const id of ids) {
      routes[`${CINEMETA}/meta/movie/${id}.json`] = async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return json({});
      };
    }
    const { fetchImpl } = fakeFetch(routes);
    await Promise.all(ids.map((id) => resolveCandidate({ id, type: "movie" }, { fetchImpl })));
    assert.equal(peak, 4);
  });
});

describe("live providers", { skip: !process.env.PROVIDERS_LIVE && "set PROVIDERS_LIVE=1 to hit the real APIs" }, () => {
  const log = (label, value) => console.log(`[live] ${label}: ${JSON.stringify(value)}`);

  it("Cinemeta search returns The Queen's Gambit as a series candidate", { timeout: 60000 }, async () => {
    const result = await searchCandidates("The Queen's Gambit", { type: "series" });
    log("search The Queen's Gambit", result.slice(0, 3));
    assert.ok(result.some((c) => c.id === "tt10048342" && c.provider === "Cinemeta"));
  });

  it("IMDb suggestions resolve Chinese titles to IMDb ids", { timeout: 60000 }, async () => {
    for (const [query, id] of [["鱿鱼游戏", "tt10919420"], ["流浪地球", "tt7605074"], ["后翼弃兵", "tt10048342"]]) {
      const result = await searchCandidates(query);
      log(`search ${query}`, result.slice(0, 3));
      assert.ok(result.some((c) => c.id === id && c.provider === "IMDb"), `${query} -> ${id}`);
    }
  });

  it("resolves a movie rating via Cinemeta", { timeout: 60000 }, async () => {
    const result = await resolveCandidate({ id: "tt1375666", type: "movie" });
    log("resolve Inception", result);
    assert.equal(result.ratings.imdb.provider, "Cinemeta");
    assert.ok(result.ratings.imdb.value > 0 && result.ratings.imdb.value <= 10);
    assert.equal(result.ratings.tvmaze, undefined);
  });

  it("resolves both IMDb (via Cinemeta) and TVmaze ratings for a series", { timeout: 60000 }, async () => {
    const result = await resolveCandidate({ id: "tt5753856", type: "series" });
    log("resolve Dark", result);
    assert.equal(result.ratings.imdb.provider, "Cinemeta");
    assert.equal(result.ratings.tvmaze.provider, "TVmaze");
    assert.match(result.ratings.tvmaze.url, /^https:\/\/www\.tvmaze\.com\/shows\/17861/);
  });
});
