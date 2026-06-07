# IMDb Link Patch

All TV show pills have been converted to IMDb search links.

Implementation pattern:

```html
<a class="show-pill" href="https://www.imdb.com/find/?s=tt&q=Breaking%20Bad" target="_blank" rel="noopener noreferrer">
  Breaking Bad <span class="imdb-mark">IMDb</span>
</a>
```

This uses IMDb search URLs instead of hard-coded title IDs, so the links remain easy to maintain if show titles change.
