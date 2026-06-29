/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createApiFactory,
  createComponentExtension,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { CatalogAssistantClient } from './api/CatalogAssistantClient';
import { catalogAssistantApiRef } from './api/types';
import { rootRouteRef } from './routes';

export const catalogAssistantPlugin = createPlugin({
  id: 'catalog-assistant',
  routes: {
    root: rootRouteRef,
  },
  apis: [
    createApiFactory({
      api: catalogAssistantApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new CatalogAssistantClient(discoveryApi, fetchApi),
    }),
  ],
});

/**
 * Routable page extension — mount this at a route and add a sidebar item that
 * links to it. See the README for the `App.tsx` / `Root.tsx` wiring.
 */
export const CatalogAssistantPage = catalogAssistantPlugin.provide(
  createRoutableExtension({
    name: 'CatalogAssistantPage',
    component: () =>
      import('./components/CatalogAssistantPage').then(
        m => m.CatalogAssistantPage,
      ),
    mountPoint: rootRouteRef,
  }),
);

/**
 * Floating chat widget (bottom-right) — mount once in your app's root layout so
 * it's available on every page, no route or sidebar item required. This is a
 * component extension (not routable), which also registers the plugin's API.
 * See the README for the one-line `Root.tsx` wiring.
 */
export const CatalogAssistantChat = catalogAssistantPlugin.provide(
  createComponentExtension({
    name: 'CatalogAssistantChat',
    component: {
      lazy: () =>
        import('./components/CatalogAssistantChat').then(
          m => m.CatalogAssistantChat,
        ),
    },
  }),
);
