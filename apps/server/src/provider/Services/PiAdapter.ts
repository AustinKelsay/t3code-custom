/**
 * PiAdapter — shape type for the Pi provider adapter.
 *
 * The driver model bundles one adapter per instance as a captured closure;
 * this file keeps a named shape interface aligned with the other providers.
 *
 * @module PiAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface PiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
