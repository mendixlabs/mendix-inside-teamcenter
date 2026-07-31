# mx-in-tc kit

This Active Workspace kit provides a `MendixEmbedded` component that embeds a Mendix application inside Teamcenter. This is the default kit.

## Configuration

Use the Mendix application URL as the component configuration. Optional URL query parameters pass fields from `props.ctx.selected` to Mendix:

```text
https://mx-in-tc-endpoint.com/?itemType=type&uid
```

This passes:

```js
{
  itemType: props.ctx.selected.type,
  uid: props.ctx.selected.uid
}
```

Use `target=source` to rename a parameter. A parameter without a value uses the same name for both sides, so `uid` is shorthand for `uid=uid`. Missing selected fields are passed as `undefined`. Use a plain URL when no context parameters are needed.

In XRT XML, write `&` as `&amp;`:

```xml
context="https://mx-in-tc-endpoint.com/?itemType=type&amp;uid"
```

In JSON configuration, use a normal `&`:

```json
"declarativeKeyContext": "https://mx-in-tc-endpoint.com/?itemType=type&uid"
```
