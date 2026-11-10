# Resolution selector update

- Added 480p, 720p, and 1080p portrait export choices.
- 720p is selected by default.
- 480p is intended for quick visual/story tests.
- 1080p is available for final Full HD exports.
- Resolution is sent to the API and applied to both render dimensions:
  - 480p: 480 x 854
  - 720p: 720 x 1280
  - 1080p: 1080 x 1920
- Frame rate remains 30 FPS.
- This change applies to newly created episodes. It does not change a render already in progress.
