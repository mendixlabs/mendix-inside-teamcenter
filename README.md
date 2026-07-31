# Mendix inside Teamcenter

This repository contains the `mx-in-tc` Active Workspace kit, which provides the `MendixEmbedded` component for embedding a Mendix application inside Teamcenter. The kit is intended as a starting point and can be customized for your integration.

## Installation

1. Clone or download this repository.
1. Copy the `mx-in-tc` kit into the Active Workspace repository of Teamcenter.
1. Rebuild Active Workspace.

## Setup

For full setup instructions, see the [Mendix Inside Teamcenter documentation](https://docs.mendix.com/refguide/mendix-client/mendix-inside-teamcenter/).

### Configuration

Configure the component with the Mendix application URL. To pass fields from the selected Teamcenter object to Mendix, add them as URL query parameters:

```text
https://<mendix-url>/?<mendix-parameter>=<selected-field>&<selected-field>
```

Each query parameter describes a value read from `props.ctx.selected`:

| Configuration       | Result passed to Mendix                                              |
| ------------------- | -------------------------------------------------------------------- |
| `?uid`              | `{ uid: props.ctx.selected.uid }`                                    |
| `?ItemUID=uid`      | `{ ItemUID: props.ctx.selected.uid }`                                |
| `?ItemUID=uid&type` | `{ ItemUID: props.ctx.selected.uid, type: props.ctx.selected.type }` |

Use `target=source` when the Mendix parameter and Teamcenter field have different names. When only a name is provided, it is used as both target and source, so `type` is shorthand for `type=type`.

The component removes these query parameters from the URL before loading Mendix. If a selected field is unavailable, its Mendix parameter receives `undefined`. To pass no context parameters, configure only the plain Mendix URL.

### XRT view

Add the embedded Mendix application to a Teamcenter object by adding the following to the XRT using the XRT editor:

```html
<htmlPanel
  declarativeKey="MendixEmbedded"
  context="https://mx-in-tc-endpoint.com/?uid&amp;itemType=type"
></htmlPanel>
```

XRT is XML, so a literal `&` cannot appear in an attribute value. Write each separator as `&amp;` to keep the XRT valid. The XML parser decodes it before passing the configuration to the component, which receives a normal `&`.

### PLM Home

Add the component to PLM Home by adding it to the cards in `layoutsViewModel` on the home screen:

```json
"Mendix": {
  "title": "Mendix",
  "view": "MendixEmbedded",
  "anchor": "",
  "props": {
    "subPanelContext": {
      "declarativeKeyContext": "https://mx-in-tc-endpoint.com/?uid&itemType=type"
    }
  }
}
```

Set `declarativeKeyContext` to the same URL and parameter mappings. Unlike XML, a JSON string can contain `&` directly, so do not replace it with `&amp;`.

Once added, the card can be placed in the layout handler grid.

### Disabling authentication

The component validates the Mendix session and starts Teamcenter SSO when needed. If authentication is not required, remove the session check from `mx-in-tc/src/assets/js/mendixEmbeddedService.js`:

```diff
-            await ensureHasValidSession(mendixUrl);
```

Also remove `ensureHasValidSession` from the import in the same file:

```diff
-import { ensureHasValidSession, getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';
+import { getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';
```

Only disable authentication when the Mendix application is intentionally accessible without Teamcenter SSO, such as in a local development environment.
