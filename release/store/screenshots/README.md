# Installed Android screenshots

Version 1.0.0 (1), source commit `5d6188c`, proposed package `io.github.shaunxd.canasta`. These are images of an installed Android build on API 36 ARM64 emulators using synthetic players.

The unsigned AAB SHA-256 is `3ca8f703375ef4a9812e2a02440a9d601e82c613a9a7df0635a97f6869be8004`. Bundletool produced a universal APK from the same AAB for sideloading under a local testing certificate. Its SHA-256 is `ac1e74e3746b43567af5e481b98e501e3bc016a2306a222113a3a024867d1b40`. The installed base APK checksum on CardsPhone was verified via ADB. See [the release journal](../../../PROGRESS.md) for signing and Play-track status.

Lead with the partnership table, followed by the teammate meld, round score and match setup. The first three are native 16:9 gameplay screens. The foldable captures show the larger table in both orientations.

| PNG | Native dimensions | Emulator and orientation | Alt text |
| --- | ---: | --- | --- |
| [foldable-offline-meld.png](foldable-offline-meld.png) | 2268 × 2440 | CanastaOpen, unfolded portrait | Three cards melded on the local team’s board during offline solo play. |
| [foldable-online-table.png](foldable-online-table.png) | 2440 × 2268 | CanastaOpen, unfolded landscape | A hand of cards and the opening discard in an online singles match on the unfolded table. |
| [phone-match-setup.png](phone-match-setup.png) | 1080 × 1920 | CardsPhone, portrait | Choose solo or online play, set a target score and timer, and choose singles or doubles. |
| [phone-partnership-meld.png](phone-partnership-meld.png) | 1920 × 1080 | CardsPhone, landscape | The teammate bot takes its turn beside a long diamond meld with an empty stock. |
| [phone-partnership-table.png](phone-partnership-table.png) | 1920 × 1080 | CardsPhone, landscape | A hand of cards beneath two teams’ melds in an online partnership match, with the partner seated opposite. |
| [phone-round-score.png](phone-round-score.png) | 1920 × 1080 | CardsPhone, landscape | The round breakdown shows Team Red on 285 points and Team Blue on minus 135. |

CardsPhone captures came from `adb exec-out screencap -p`. The store exporter preserved every native pixel outside the room-code text in the table header. CanastaOpen gameplay was captured from the installed foldable emulator by QA and its room-code region was masked in the evidence file before store export. Images were saved as RGB PNG at native resolution with no decorative frames or marketing overlays.
