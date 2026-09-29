# The Song Rank

**Live:** [ethikry.dev/projects/song-rank](https://ethikry.dev/projects/song-rank/)

A dashboard for an annual song ranking. Every year a group of friends
nominates songs, everyone scores every song out of 10 (plus one 11 each, their
super vote), and the results are a party. This site turns four years of those
score sheets into cumulative stats, awards, taste analysis and a presentation
deck for the night itself.

It was built for a real, private group. This repository is a public copy of it
with the identifying details swapped out:

- **The scores are real.** Every score, rank and nomination is exactly what the
  group entered, so every statistic, award and chart is a real one.
- **Nothing else is.** The rankers are made-up handles with generated faces.
  The artists and songs are popular stand-ins, chosen so that collaborations
  still map onto real collaborations. The written comments were regenerated
  from scratch to match each ranker's tone and verbosity.

The anonymized data in `demo/data/` passes the same validation as the real data
(1205 checks against the group's own published analysis tabs). A separate check
confirms that no real name, title or link survives in this repository or in the
deployed site.

## What's in it

- **Year chapters.** Full rankings, score distributions, award podiums and
  where every 11 went, plus comment analytics: a word cloud and a keyness
  analysis of which words the favourites attracted.
- **Taste.** Pairwise correlations between rankers, a taste map (classical
  MDS), and a decomposition of each correlation into the artists that built it.
  Pearson's numerator is a sum over shared songs, so grouping those terms by
  artist says exactly which artists made two people agree.
- **Head to Head.** Any two rankers side by side, with their common ground and
  their battlegrounds.
- **The Lab.** The same ballots counted other ways (trimmed mean, median, Borda
  count, majority judgment), and counterfactuals: who could have changed the
  podium, and which songs one voter carried or buried.
- **Nominations.** Each nominator's record, including where their picks
  finished once their own scores are struck out.
- **The Recap.** A per-ranker summary with a downloadable share card, drawn as
  SVG and exported to PNG in the browser.
- **The showcase.** `/present/<year>` is a full-screen slide deck of the year's
  results, built for presenting live.

Everything is recomputed in the browser from the raw score matrix. There is no
backend.

## Running it

```sh
pnpm install        # or npm install
pnpm dev            # http://localhost:5173/projects/song-rank/
pnpm build          # static build in dist-demo/
pnpm validate       # recompute every statistic and check it against the sheets
```

React 18, TypeScript, Vite; no charting or UI libraries (every chart is
hand-written SVG). The site is served under `/projects/song-rank/`, the path it
lives at on ethikry.dev.

## How the data is laid out

The code reads everything about its subject through an `@data` alias: the
year CSVs, portraits, the artist → genre map, and even the site's name and
award titles (`site.json`). The private original points it at the real data;
this copy points it at `demo/data/`. That's why no component names its
subject, and why the same code serves both.

```
demo/data/<year>/*.csv     each year's exported score sheet and analysis tabs
demo/data/site.json        the site's name, tagline and award titles
demo/data/branches.json    artist → genre
demo/data/artist_avatars/  artist photos + credits.json
demo/data/avatars/         the rankers' generated faces
src/lib/                   parsing, statistics, awards, taste decomposition
src/pages/                 one file per page
scripts/validate.ts        the validation harness
```

## Credits

The artist photos come from Wikimedia Commons under CC0, public domain, CC BY
and CC BY-SA licences. Each is credited on the site's
[credits page](https://ethikry.dev/projects/song-rank/#/credits) and in
`demo/data/artist_avatars/credits.json`. Music videos are embedded from YouTube.
Inclusion implies no endorsement by the artists or photographers.

## License

The code is under the [MIT License](LICENSE). The artist photos are not
covered by it: each keeps its own Commons licence, listed in `credits.json`.
The scores are the group's, shared here in anonymized form.

This repository is an exported snapshot. Development happens in the private
original, and changes arrive here as periodic snapshot commits.
