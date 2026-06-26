# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-06-26

### Fixed
- Fixed an extension installation error in Chrome by removing the `scripts` array from the `background` object in `manifest.json`. The `scripts` array is a Manifest V2 feature and is not permitted in Manifest V3, which instead uses `service_worker`.
