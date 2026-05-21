/**
 * Patient app entry point.
 * Mounts the root Svelte component into #app.
 */
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
