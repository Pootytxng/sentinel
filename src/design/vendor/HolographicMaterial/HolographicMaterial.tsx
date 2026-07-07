// Vendored from threejs-holographic-material (github.com/ektogamat/threejs-holographic-material).
// Copyright (c) 2023 Anderson Mancini. MIT License.
// Full license + local-modification notes: src/design/vendor/THIRD_PARTY.md
//
// Local modifications (Compy, 2026-07-06 — T4d hologram bay v2):
// - Converted to TypeScript (typed props, typed shader-material ref).
// - Upstream used `ref.current.time += delta` without a null guard (crashes on the first
//   demand-mode frame before the material mounts) — guarded.
// - `enableAdditive`/`side` removed from the shaderMaterial useMemo deps (they are mesh-level
//   props, not uniforms; upstream listing them re-compiled the shader on toggle).
// - Under reduced motion callers pass signalSpeed=0 + enableBlinking=false: every animated
//   term in the fragment shader multiplies by signalSpeed, so the hologram renders fully
//   static — no scanline drift, no flicker.
// - Vendor default hologramColor is NEVER used by Compy: callers wire the live theme accent
//   (use-rig-colors), same law as the Stepper's token re-point.

import { useRef, useMemo } from "react";
import { shaderMaterial } from "@react-three/drei";
import { extend, useFrame, type ThreeElement } from "@react-three/fiber";
import {
  Color,
  FrontSide,
  BackSide,
  DoubleSide,
  AdditiveBlending,
  NormalBlending,
  type ShaderMaterial,
} from "three";

export interface HolographicMaterialProps {
  /** Fresnel rim strength, 0–1. */
  fresnelAmount?: number;
  /** Fresnel rim opacity, 0–1. */
  fresnelOpacity?: number;
  /** Scanline density, 1–15. */
  scanlineSize?: number;
  /** Overall brightness, 0–2. */
  hologramBrightness?: number;
  /** Signal/scan animation speed, 0–2 (0 = fully static — the reduced-motion path). */
  signalSpeed?: number;
  /** Hologram color — Compy always passes the live theme accent. */
  hologramColor?: string;
  /** Random blink/flicker. */
  enableBlinking?: boolean;
  /** Blink only the fresnel rim, not the body. */
  blinkFresnelOnly?: boolean;
  /** Additive blending (glow-on-dark) vs normal. */
  enableAdditive?: boolean;
  /** Overall opacity, 0–1. */
  hologramOpacity?: number;
  side?: "FrontSide" | "BackSide" | "DoubleSide";
}

type HoloShaderMaterial = ShaderMaterial & { time: number };

export default function HolographicMaterial({
  fresnelAmount = 0.45,
  fresnelOpacity = 1.0,
  scanlineSize = 8.0,
  hologramBrightness = 1.2,
  signalSpeed = 0.45,
  hologramColor = "#51a4de",
  enableBlinking = true,
  blinkFresnelOnly = true,
  enableAdditive = true,
  hologramOpacity = 1.0,
  side = "FrontSide",
}: HolographicMaterialProps) {
  const ref = useRef<HoloShaderMaterial>(null);

  const HolographicMaterialImpl = useMemo(() => {
    return shaderMaterial(
      {
        time: 0,
        fresnelOpacity: fresnelOpacity,
        fresnelAmount: fresnelAmount,
        scanlineSize: scanlineSize,
        hologramBrightness: hologramBrightness,
        signalSpeed: signalSpeed,
        hologramColor: new Color(hologramColor),
        enableBlinking: enableBlinking,
        blinkFresnelOnly: blinkFresnelOnly,
        hologramOpacity: hologramOpacity,
      },
      /* GLSL — vertex (verbatim from upstream) */
      `
      #define STANDARD
      varying vec3 vViewPosition;
      #ifdef USE_TRANSMISSION
      varying vec3 vWorldPosition;
      #endif

      varying vec2 vUv;
      varying vec4 vPos;
      varying vec3 vNormalW;
      varying vec3 vPositionW;

      #include <common>
      #include <uv_pars_vertex>
      #include <envmap_pars_vertex>
      #include <color_pars_vertex>
      #include <fog_pars_vertex>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      #include <clipping_planes_pars_vertex>

      void main() {

        #include <uv_vertex>
        #include <color_vertex>
        #include <morphcolor_vertex>

        #if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )

          #include <beginnormal_vertex>
          #include <morphnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <defaultnormal_vertex>

        #endif

        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        #include <logdepthbuf_vertex>
        #include <clipping_planes_vertex>

        #include <worldpos_vertex>
        #include <envmap_vertex>
        #include <fog_vertex>

        mat4 modelViewProjectionMatrix = projectionMatrix * modelViewMatrix;

        vUv = uv;
        vPos = projectionMatrix * modelViewMatrix * vec4( transformed, 1.0 );
        vPositionW = vec3( vec4( transformed, 1.0 ) * modelMatrix);
        vNormalW = normalize( vec3( vec4( normal, 0.0 ) * modelMatrix ) );

        gl_Position = modelViewProjectionMatrix * vec4( transformed, 1.0 );

      }`,
      /* GLSL — fragment (verbatim from upstream) */
      `
      varying vec2 vUv;
      varying vec3 vPositionW;
      varying vec4 vPos;
      varying vec3 vNormalW;

      uniform float time;
      uniform float fresnelOpacity;
      uniform float scanlineSize;
      uniform float fresnelAmount;
      uniform float signalSpeed;
      uniform float hologramBrightness;
      uniform float hologramOpacity;
      uniform bool blinkFresnelOnly;
      uniform bool enableBlinking;
      uniform vec3 hologramColor;

      float flicker( float amt, float time ) {return clamp( fract( cos( time ) * 43758.5453123 ), amt, 1.0 );}
      float random(in float a, in float b) { return fract((cos(dot(vec2(a,b) ,vec2(12.9898,78.233))) * 43758.5453)); }

      void main() {
        vec2 vCoords = vPos.xy;
        vCoords /= vPos.w;
        vCoords = vCoords * 0.5 + 0.5;
        vec2 myUV = fract( vCoords );

        // Defines hologram main color
        vec4 hologramColor = vec4(hologramColor, mix(hologramBrightness, vUv.y, 0.5));

        // Add scanlines
        float scanlines = 10.;
        scanlines += 20. * sin(time *signalSpeed * 20.8 - myUV.y * 60. * scanlineSize);
        scanlines *= smoothstep(1.3 * cos(time *signalSpeed + myUV.y * scanlineSize), 0.78, 0.9);
        scanlines *= max(0.25, sin(time *signalSpeed) * 1.0);

        // Scanlines offsets
        float r = random(vUv.x, vUv.y);
        float g = random(vUv.y * 20.2, 	vUv.y * .2);
        float b = random(vUv.y * .9, 	vUv.y * .2);

        // Scanline composition
        hologramColor += vec4(r*scanlines, b*scanlines, r, 1.0) / 84.;
        vec4 scanlineMix = mix(vec4(0.0), hologramColor, hologramColor.a);

        // Calculates fresnel
        vec3 viewDirectionW = normalize(cameraPosition - vPositionW);
        float fresnelEffect = dot(viewDirectionW, vNormalW) * (1.6 - fresnelOpacity/2.);
        fresnelEffect = clamp(fresnelAmount - fresnelEffect, 0., fresnelOpacity);

        // Blinkin effect
        //Suggested by Octano - https://x.com/OtanoDesign?s=20
        float blinkValue = enableBlinking ? 0.6 - signalSpeed : 1.0;
        float blink = flicker(blinkValue, time * signalSpeed * .02);

        // Final shader composition
        vec3 finalColor;

        if(blinkFresnelOnly){
          finalColor = scanlineMix.rgb + fresnelEffect * blink;
        }else{
          finalColor = scanlineMix.rgb * blink + fresnelEffect;
        }

        gl_FragColor = vec4( finalColor, hologramOpacity);

      }`,
    );
  }, [
    fresnelAmount,
    fresnelOpacity,
    scanlineSize,
    hologramBrightness,
    signalSpeed,
    hologramColor,
    enableBlinking,
    blinkFresnelOnly,
    hologramOpacity,
  ]);

  extend({ HolographicMaterial: HolographicMaterialImpl });

  useFrame((_, delta) => {
    if (ref.current) ref.current.time += delta;
  });

  return (
    <holographicMaterial
      key={HolographicMaterialImpl.key}
      side={side === "DoubleSide" ? DoubleSide : side === "BackSide" ? BackSide : FrontSide}
      transparent={true}
      blending={enableAdditive ? AdditiveBlending : NormalBlending}
      ref={ref}
    />
  );
}

declare module "@react-three/fiber" {
  interface ThreeElements {
    holographicMaterial: ThreeElement<typeof ShaderMaterial>;
  }
}
