import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHARACTER_URLS, PROP_URLS, WEAPON_URLS, configureLoader } from "./models";

let started = false;

/**
 * Start downloading and decoding every Battle Arena model into the loader cache.
 * Called from the home page so tapping Play opens the finished map straight away.
 */
export function preloadBattle() {
  if (started) return;
  started = true;
  for (const urls of [CHARACTER_URLS, WEAPON_URLS, PROP_URLS]) useLoader.preload(GLTFLoader, urls, configureLoader);
}
