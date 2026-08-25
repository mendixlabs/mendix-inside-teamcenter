# mx-in-tc kit

This Active Workspace kit provides a `MendixEmbedded` component that embeds a Mendix application inside Teamcenter.

### Configuration

Configure the component with the Mendix application URL.

```text
https://mx-in-tc-endpoint.com
```

To pass fields from the Active Workspace component context to Mendix, add explicit mappings as URL query parameters:

```text
https://mx-in-tc-endpoint.com/?uid={selected.uid}
```

Wrap a value in braces to read it from the component `ctx` object:

| Configuration                              | Result passed to Mendix                          |
| ------------------------------------------ | ------------------------------------------------ |
| `?itemUID={selected.uid}`                  | `{ itemUID: ctx.selected.uid }`                  |
| `?modelTypeName={selected.modelType.name}` | `{ modelTypeName: ctx.selected.modelType.name }` |
| `?mode=edit`                               | `{ mode: "edit" }`                               |
| `?limit=10&editable=true`                  | `{ limit: 10, editable: true }`                  |

Mappings are always explicit: use `target={context.path}` to map a context value or `target=value` for a hardcoded value.

Use dot notation inside the braces to read nested fields. For example, `modelTypeName={selected.modelType.name}` reads the value at `ctx.selected.modelType.name` and passes it as `modelTypeName`. The resolved value must be a primitive, such as a string, number, or boolean; objects and arrays are not supported as Mendix parameters. If any part of the path is unavailable, the parameter receives `undefined`.

Values without braces are hardcoded primitives. `true` and `false` become booleans, JSON-formatted numbers become numbers, and other values remain strings. JSON-quoted strings are also supported; encode their double quotes as `%22` in the URL. This can force a value such as `%22true%22` to remain the string `"true"` instead of becoming a boolean.

```text
https://mx-in-tc-endpoint.com/?activeView={ui}&itemUID={selected.uid}&mode=edit&limit=10
```

This passes `{ uid: ctx.selected.uid, mode: "edit", limit: 10 }`.

The component removes these query parameters from the URL before loading Mendix. If a mapped context field is unavailable, its Mendix parameter receives `undefined`.

### XRT view

Add the embedded Mendix application to a Teamcenter object by adding the following to the XRT using the XRT editor:

```xml
<htmlPanel
  declarativeKey="MendixEmbedded"
  context="https://mx-in-tc-endpoint.com/?uid={selected.uid}&amp;mode=edit"
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
      "declarativeKeyContext": "https://mx-in-tc-endpoint.com/?uid={selected.uid}&mode=edit"
    }
  }
}
```

Set `declarativeKeyContext` to the same URL and parameter mappings. Unlike XML, a JSON string can contain `&` directly, so do not replace it with `&amp;`.

Once added, the card can be placed in the layout handler grid.

### Disabling authentication

The component validates the Mendix session and starts Teamcenter SSO when needed. To disable authentication, remove the session check from `mx-in-tc/src/js/mendixEmbeddedService.js`:

```diff
-            await ensureHasValidSession(mendixUrl);
```

Also remove `ensureHasValidSession` from the import in the same file:

```diff
-import { ensureHasValidSession, getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';
+import { getMendixConfiguration, getMendixParameters } from './mendixEmbeddedUtils';
```

Only disable authentication when the Mendix application is intentionally accessible without Teamcenter SSO, such as in a local development environment.
