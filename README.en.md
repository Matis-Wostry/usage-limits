# usage-limits

[Français](README.md) · **English**

A mod for Claude Code that shows your usage limits (5-hour session and week) above the prompt, with a pace verdict:

- **Push**: you are using less than time is passing, you have room.
- **On pace**: you are on pace.
- **Slow down**: you are using faster than time is passing.
- **Near limit**: a window is close to the alert threshold.

The 5-hour window sets the verdict; the 7-day window only breaks ties. The black mark on each bar shows how much of the window has elapsed: colour stopping short of the mark means you have room, colour past it means you are using too fast. The band follows the clock even without a new reply: a window past its reset starts over at 0%.

The mod speaks French by default. To switch it to English once installed:

```
/usage-limits-config language=en
```

## Installation

### With GitHub (recommended)

In a Claude Code session (terminal):

```
/plugin install usage-limits --marketplace Matis-Wostry/usage-limits
```

Answer `y` to add the marketplace, then pick the scope (user, to have it everywhere). In the desktop app, where `/plugin` does not work: click **+** next to the prompt, **Plugins**, **Add marketplace** with `Matis-Wostry/usage-limits`, then **Add plugin**.

### Without the marketplace (local folder)

1. Get the repository in a folder of yours, for example:

   ```
   git clone https://github.com/Matis-Wostry/usage-limits.git D:\mods\usage-limits
   ```

2. Either:
   - **To try it**: run `claude --plugin-dir "D:\mods\usage-limits"`.
   - **For good**: in your user `settings.json` (`~/.claude/settings.json`, or `%USERPROFILE%\.claude\settings.json` on Windows), add:

     ```json
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "D:\\mods\\usage-limits"
     }
     ```

3. Open a new session (or type `/reload-plugins` if you have it), then send Claude a message: the band only appears after its first reply.

## Updating

### Installed with the marketplace

In a terminal:

```
claude plugin marketplace update usage-limits
claude plugin update usage-limits@usage-limits
```

The first command fetches the latest version from GitHub, the second installs it. Then restart Claude Code for it to apply.

In the desktop app: click **+** next to the prompt, **Plugins**, refresh the `usage-limits` marketplace, then update the plugin.

### Installed from a local folder

In the repository's folder:

```
git pull
```

Then type `/reload-plugins` (or open a new session) and send Claude a message: the band comes back after its first reply.

### Checking the version

`/usage-limits-config` should list the `language`, `resetFormat`, `showForecast` and `history` settings: they came with 0.13.0.

## Where it shows

The band shows in **VS Code** and in the **Code tab of the desktop app**. After an update, open a new session in the app: it does not reload the mod in a session already open. If the band is missing, type `/limits` (`/limites` in French): an answer with figures proves the mod is loaded.

## Commands

With `language=en`:

- `/limits`: details in text, and brings the band back if hidden.
- `/limits-hide`: hides the band.
- `/limits-history`: opens the history pane, if the `history` option is on.
- `/usage-limits-config`: lists the mod's settings; `/usage-limits-config showPaceMark=false` changes one.

In French, the commands are `/limites`, `/limites-masquer` and `/limites-historique`.

## Language

The whole mod exists in French and in English: the band, the commands, the messages, the pane and the `/config` menu. `language` picks one, and French is the default.

## Forecast

When your current usage would take you to a limit before it resets, a line says so under the band and in `/limits`: "At this pace: 5 h limit in 25 min". Nothing shows if the reset comes first, nor during the first tenth of a window, when one big request would skew the calculation. `showForecast=false` removes the line.

## Reset

`resetFormat` picks how the reset is written, under the band, in `/limits` and when hovering a bar:

- `duration` (the default): the time left, "session 1 h 15".
- `clock`: the time, in your time zone, "session at 18:40 · week Sat at 21:05".

## History

The pane is off by default. To turn it on:

```
/usage-limits-config history=true
```

It then opens at each session, beside the conversation; `/limits-history` reopens it if you closed it. For each day, it shows the peak of each limit and the tokens used, without the cache reads. The history spans your sessions and keeps 90 days at most.

With `history=false`, the pane closes and nothing more is recorded. What was already recorded is kept, and comes back if you turn the option on again.

## Tokens

Under the band, a line gives the last turn's tokens (input, output), the session's total (subagents included) and the context fill. The input also counts what the cache served; `/limits` details that part. The totals start with the session, survive a reload of the mod and go back to zero after `/clear` or `/resume`. The line comes back with the next reply.

## Fable

When Claude Code reports a limit of its own for a model (for example `seven_day_fable`), its bar only shows while that model is selected (`/model`), and then replaces the "7 d" bar. With no Fable limit reported, the "7 d" bar stays.

## Configuration

Three ways to set the mod up:

- `/usage-limits-config`: lists the settings and their current value.
- `/usage-limits-config setting=value`: changes one, for example `/usage-limits-config barHeight=10`. For booleans, `true`/`false`, `on`/`off`, `yes`/`no` and `1`/`0` all work.
- `/config`: the same settings, in Claude Code's menu.

### Settings

| Setting | Values | Default | Effect |
|---|---|---|---|
| `language` | `fr`, `en` | `fr` | Language of the band, the commands, the messages, the pane and the `/config` menu. |
| `windows` | `both`, `five_hour`, `seven_day` | `both` | The limits shown: both, only the 5-hour session, or only the week. |
| `warnAt` | 1 to 100 (%) | `90` | Alert threshold: from there, that limit's bar turns red, the verdict becomes "Near limit" and a notification shows. |
| `cautionAt` | 1 to 100 (%) | `70` | Caution threshold: from there, that limit's bar turns orange. |
| `paceMargin` | 0 to 50 (points) | `8` | Neutral zone: as long as the gap between usage and elapsed time stays under this value, the pace is "on pace". |
| `showDelta` | `true`, `false` | `false` | Writes the gap in points beside each bar, for example `+12`. |
| `showPaceMark` | `true`, `false` | `true` | Draws on each bar the mark of the time elapsed in the window. |
| `showForecast` | `true`, `false` | `true` | Says when the limit will be reached at this pace, if that comes before the reset. |
| `showReset` | `true`, `false` | `true` | Adds under the band the line "Reset: session … · week …". |
| `resetFormat` | `duration`, `clock` | `duration` | Writes the reset as the time left or as the time. |
| `showTokens` | `true`, `false` | `true` | Adds under the band the tokens line: last turn, session, context. |
| `barHeight` | 2 to 20 (px) | `6` | Thickness of the bars. The terminal draws its bars in text and ignores this. |
| `bandPadding` | 0 to 3 (rows) | `1` | Height of the band: the margin above and below its content. `0` makes it as low as it gets. |
| `layout` | `auto`, `wide`, `medium`, `narrow` | `auto` | Layout: `auto` adapts to the width, the others force one. |
| `isCompact` | `true`, `false` | `false` | Compact style: no bar, only the limit's name and the percentage. |
| `history` | `true`, `false` | `false` | Turns on the history pane and the recording. |

### Examples

```
/usage-limits-config barHeight=12
/usage-limits-config bandPadding=0
/usage-limits-config showTokens=off
/usage-limits-config windows=five_hour
/usage-limits-config warnAt=80
/usage-limits-config resetFormat=clock
/usage-limits-config history=true
```

When a long prompt leaves little room, the band removes by itself, in order, the tokens line, the reset line, the forecast, the margin and then the border, whatever these settings say.
