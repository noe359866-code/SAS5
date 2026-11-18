# Streamflix attribution

The experimental PelisPlus resolver in `lib/pelisplus.js` includes a JavaScript
adaptation of the field-based extraction approach documented in Streamflix's
VidHide and Dropload extractors. Streamflix is an Apache License 2.0 project:
https://git.gay/streamflix-reborn2/streamflix

Sources reviewed on 2026-11-18:
- `app/src/main/java/com/streamflixreborn/streamflix/extractors/VidHideExtractor.kt`
- `app/src/main/java/com/streamflixreborn/streamflix/extractors/DroploadExtractor.kt`

Modifications: reimplemented for this JavaScript/Cloudflare Worker addon;
restricted hostnames and URLs, limited requests, avoided executing player
scripts and following redirects, preserved the Spanish-audio filter, and
marked CDN links unverified. This does not include Streamflix's Android code.
See `STREAMFLIX-APACHE-2.0.txt` for the license.
