# Local rendering optimization notes

This package keeps the existing application and rendering pipeline, with conservative changes aimed at reducing peak resource use on CPU/software-rendered Docker setups:

- One render worker by default (`RENDER_CHUNKS=1`) to avoid running multiple Chromium + WebGL renderers concurrently.
- Unsigned-byte render target with MSAA disabled to reduce render-target memory and software-rendering work.
- FFmpeg `veryfast` preset at CRF 20 for materially lower encode CPU time than `slow`/CRF 18.
- Chromium uses `--disable-dev-shm-usage` and startup flags suitable for a constrained container.

Trade-offs:
- The render target / MSAA change may slightly affect image smoothness or post-processing appearance. Review a short test render before relying on it for a final export.
- CRF 20 and `veryfast` trade some compression efficiency / file size for faster encoding.
- One chunk is intended to lower peak RAM/CPU pressure and improve stability; it is not guaranteed to reduce total elapsed time on every machine.

The original project structure and API are retained. Generated `storage/`, Git history, and certificate files are intentionally excluded from this archive. Restore your corporate root certificate locally under `certs/` before building if your network requires it; never share or commit that private certificate.
