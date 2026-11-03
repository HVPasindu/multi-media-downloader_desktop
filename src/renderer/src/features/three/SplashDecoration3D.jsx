import { useRef, useMemo, Component } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Fallback static CSS decoration rendered if WebGL is unsupported or throws an error.
 */
function StaticFallback({ className = '' }) {
  return (
    <div
      className={`relative flex items-center justify-center pointer-events-none ${className}`}
      aria-hidden="true"
    >
      <div className="w-40 h-40 rounded-full border border-primary/30 shadow-[0_0_35px_rgba(25,216,255,0.35)] animate-pulse" />
      <div className="absolute w-28 h-28 rounded-full border border-accent/40 shadow-[0_0_25px_rgba(81,75,255,0.3)]" />
    </div>
  )
}

/**
 * Error boundary that catches WebGL context creation or shader errors gracefully.
 */
class ThreeErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.warn('Three.js decoration encountered an error; falling back to CSS glow:', error)
  }

  render() {
    if (this.state.hasError) {
      return <StaticFallback className={this.props.className} />
    }
    return this.props.children
  }
}

/**
 * Animated 3D Ring with subtle dual-color emission (Electric Cyan & Violet)
 */
function GlowingRing({ reducedMotion }) {
  const meshRef = useRef(null)
  const particlesRef = useRef(null)

  // Floating orbit particles (using deterministic coordinates for pure rendering)
  const particlePositions = useMemo(() => {
    const coords = []
    const count = 24
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const radius = 1.9 + Math.sin(i * 3) * 0.2
      const zOffset = (((i * 137) % 100) / 100 - 0.5) * 0.4
      coords.push(Math.cos(angle) * radius, Math.sin(angle) * radius, zOffset)
    }
    return new Float32Array(coords)
  }, [])

  useFrame((_, delta) => {
    if (reducedMotion) return

    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.4
      meshRef.current.rotation.y += delta * 0.6
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.z -= delta * 0.25
    }
  })

  return (
    <group>
      {/* Outer Torus Ring */}
      <mesh ref={meshRef}>
        <torusGeometry args={[1.5, 0.04, 16, 64]} />
        <meshStandardMaterial
          color="#19D8FF"
          emissive="#514BFF"
          emissiveIntensity={0.8}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* Floating Sparkle Particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.06}
          color="#19D8FF"
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

/**
 * Isolated Three.js Decorative Component for Splash Screen
 */
export default function SplashDecoration3D({ className = 'w-64 h-64' }) {
  // Check if WebGL context is available in this environment
  const webGLAvailable = useMemo(() => {
    try {
      const canvas = document.createElement('canvas')
      return Boolean(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      )
    } catch {
      return false
    }
  }, [])

  // Respect OS accessibility reduced motion preferences
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  if (!webGLAvailable) {
    return <StaticFallback className={className} />
  }

  return (
    <ThreeErrorBoundary className={className}>
      <div className={`relative pointer-events-none select-none ${className}`}>
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 4.5], fov: 45 }}
          gl={{
            alpha: true,
            antialias: true,
            powerPreference: 'low-power'
          }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.5} />
          <pointLight position={[3, 3, 3]} color="#19D8FF" intensity={1.5} />
          <pointLight position={[-3, -3, 2]} color="#514BFF" intensity={1.2} />
          <GlowingRing reducedMotion={reducedMotion} />
        </Canvas>
      </div>
    </ThreeErrorBoundary>
  )
}
