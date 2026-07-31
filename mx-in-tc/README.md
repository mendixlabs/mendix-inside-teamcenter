# mx-in-tc kit

This Active Workspace kit provides a `MendixEmbedded` component that embeds a Mendix application inside Teamcenter.

### Configuration

Configure the component with the Mendix application URL.

```text
https://mx-in-tc-endpoint.com
```

To pass fields from the selected Teamcenter object to Mendix, add them as URL query parameters:

```text
https://mx-in-tc-endpoint.com/?itemType=type&uid
```

Each query parameter describes a value read from the Active Workspace `selected` object:

| Configuration                         | Result passed to Mendix                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `?uid`                                | `{ uid: selected.uid }`                                      |
| `?itemUID=uid`                        | `{ itemUID: selected.uid }`                                  |
| `?uid&itemType=type`                  | `{ uid: selected.uid, itemType: selected.type }`             |
| `?modelTypeName=modelType.name`       | `{ modelTypeName: selected.modelType.name }`                  |

Use `target=source` when the Mendix parameter and Teamcenter field have different names. When only a name is provided, it is used as both target and source, so `uid` is shorthand for `uid=uid`.

Use dot notation to read nested fields. For example, `modelTypeName=modelType.name` reads the value at `selected.modelType.name` and passes it as `modelTypeName`. The resolved value must be a primitive, such as a string, number, or boolean; objects and arrays are not supported as Mendix parameters. If any part of the path is unavailable, the parameter receives `undefined`.

The component removes these query parameters from the URL before loading Mendix. If a selected field is unavailable, its Mendix parameter receives `undefined`.

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

The component validates the Mendix session and starts Teamcenter SSO when needed. To disable authentication, remove the session check from `mx-in-tc/src/assets/js/mendixEmbeddedService.js`:

```diff
-            await ensureHasValidSession(mendixUrl);
```

Also remove `ensureHasValidSession` from the import in the same file:

```diff
-import { ensureHasValidSession, getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';
+import { getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';
```

Only disable authentication when the Mendix application is intentionally accessible without Teamcenter SSO, such as in a local development environment.
