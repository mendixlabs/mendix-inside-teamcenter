# Mendix inside Teamcenter

This repository contains Active Workspace kits that provide the `MendixEmbedded` component for embedding a Mendix application inside Teamcenter.

Three kits are available:

- `mx-in-tc` - Default kit
- `mx-in-tc-context` - Passes the selected item's UID to the Mendix application
- `mx-in-tc-no-auth` - Skips authentication; for development use only

Choose the kit that best matches your use case and use only one variant at a time. Each kit is intended as a starting point and can be customized for your integration.

## Installation

1. Clone or download this repository.
1. Copy the desired kit into the Active Workspace repository of Teamcenter.
1. Rebuild Active Workspace.

## Setup

For full setup instructions, see the [Mendix Inside Teamcenter documentation](https://docs.mendix.com/refguide/mendix-client/mendix-inside-teamcenter/).

### XRT view

Add the embedded Mendix application to a Teamcenter object by adding the following to the XRT using the XRT editor:

```html
<htmlPanel
  declarativeKey="MendixEmbedded"
  context="https://mx-in-tc-endpoint.com/"
></htmlPanel>
```

Set `context` to the endpoint of the Mendix application.

### PLM Home

Add the component to PLM Home by adding it to the cards in `layoutsViewModel` on the home screen:

```json
"Mendix": {
  "title": "Mendix",
  "view": "MendixEmbedded",
  "anchor": "",
  "props": {
    "subPanelContext": {
      "declarativeKeyContext": "https://mx-in-tc-endpoint.com/"
    }
  }
}
```

Set `declarativeKeyContext` to the endpoint of the Mendix application.

Once added, the card can be placed in the layout handler grid.
