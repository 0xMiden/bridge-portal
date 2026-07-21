"use client";

// Single GSAP registration point. Every component imports gsap + plugins FROM
// HERE (never directly from "gsap") so registration is guaranteed to have run
// and webpack tree-shaking stays predictable. GSAP is free for commercial use
// (Webflow Standard License, 2025); core ~23KB gz, plugins imported individually.
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Flip } from "gsap/Flip";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(useGSAP, Flip, CustomEase);

export { gsap, useGSAP, Flip, CustomEase };
