/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
} from 'react'
import { gsap } from 'gsap'
import './CardSwap.css'

type CardElement = ReactElement<
  HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>
>

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...rest }, ref) => (
    <div
      ref={ref}
      {...rest}
      className={`allrouters-card-swap-card ${className}`.trim()}
    />
  )
)

Card.displayName = 'Card'

type Slot = {
  x: number
  y: number
  z: number
  zIndex: number
}

type CardSwapProps = {
  width?: number
  height?: number
  cardDistance?: number
  verticalDistance?: number
  delay?: number
  pauseOnHover?: boolean
  enableWheel?: boolean
  skewAmount?: number
  children: ReactNode
}

const makeSlot = (
  index: number,
  distX: number,
  distY: number,
  total: number
): Slot => ({
  x: index * distX,
  y: -index * distY,
  z: -index * distX * 1.5,
  zIndex: total - index,
})

const placeNow = (el: HTMLDivElement | null, slot: Slot, skew: number) => {
  if (!el) return
  gsap.set(el, {
    x: slot.x,
    y: slot.y,
    z: slot.z,
    xPercent: -50,
    yPercent: -50,
    skewY: skew,
    transformOrigin: 'center center',
    zIndex: slot.zIndex,
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    force3D: true,
  })
}

export default function CardSwap({
  width = 360,
  height = 220,
  cardDistance = 34,
  verticalDistance = 32,
  delay = 4200,
  pauseOnHover = true,
  enableWheel = true,
  skewAmount = 3,
  children,
}: CardSwapProps) {
  const childArr = useMemo(() => Children.toArray(children), [children])
  const refs = useMemo(
    () => childArr.map(() => ({ current: null as HTMLDivElement | null })),
    [childArr]
  )
  const order = useRef(Array.from({ length: childArr.length }, (_, i) => i))
  const timelineRef = useRef<gsap.core.Timeline | null>(null)
  const intervalRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isAnimatingRef = useRef(false)
  const lastWheelRef = useRef(0)

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    const total = refs.length

    refs.forEach((ref, index) => {
      placeNow(
        ref.current,
        makeSlot(index, cardDistance, verticalDistance, total),
        reduceMotion ? 0 : skewAmount
      )
    })

    if (reduceMotion || total < 2) return undefined

    const swap = () => {
      if (isAnimatingRef.current || total < 2) return

      const [front, ...rest] = order.current
      if (front == null) return
      const frontEl = refs[front]?.current
      if (!frontEl) return

      const nextOrder = [...rest, front]
      const backSlot = makeSlot(
        total - 1,
        cardDistance,
        verticalDistance,
        total
      )
      const numericHeight = Number.parseFloat(String(height)) || 220
      const exitDistance = Math.max(
        numericHeight * 0.64,
        verticalDistance * 4.2,
        150
      )
      const timeline = gsap.timeline()
      isAnimatingRef.current = true
      timelineRef.current = timeline

      timeline.set(frontEl, { zIndex: total + 1 }, 0)
      timeline.to(
        frontEl,
        {
          y: `+=${exitDistance}`,
          opacity: 0,
          scale: 0.985,
          filter: 'blur(5px)',
          duration: 0.58,
          ease: 'power2.in',
        },
        0
      )

      rest.forEach((idx, index) => {
        const el = refs[idx]?.current
        const slot = makeSlot(index, cardDistance, verticalDistance, total)
        timeline.set(el, { zIndex: slot.zIndex }, 0)
        timeline.to(
          el,
          {
            x: slot.x,
            y: slot.y,
            z: slot.z,
            scale: 1,
            opacity: 1,
            filter: 'blur(0px)',
            duration: 0.82,
            ease: 'power3.out',
          },
          0.08 + index * 0.045
        )
      })

      timeline.set(
        frontEl,
        {
          x: backSlot.x,
          y: backSlot.y - 18,
          z: backSlot.z,
          zIndex: backSlot.zIndex,
          opacity: 0,
          scale: 0.985,
          filter: 'blur(5px)',
        },
        0.58
      )
      timeline.to(
        frontEl,
        {
          y: backSlot.y,
          opacity: 1,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.42,
          ease: 'power3.out',
        },
        0.62
      )

      timeline.call(() => {
        order.current = nextOrder
        isAnimatingRef.current = false
      })
    }

    const startInterval = () => {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
      }
      intervalRef.current = window.setInterval(swap, delay)
    }

    startInterval()

    const node = containerRef.current
    const pause = () => {
      timelineRef.current?.pause()
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
      }
    }
    const resume = () => {
      timelineRef.current?.play()
      startInterval()
    }
    const handleWheel = (event: WheelEvent) => {
      if (!enableWheel) return
      event.preventDefault()
      const now = window.performance.now()
      if (now - lastWheelRef.current < 620) return
      lastWheelRef.current = now
      swap()
    }

    if (pauseOnHover && node) {
      node.addEventListener('mouseenter', pause)
      node.addEventListener('mouseleave', resume)
    }
    if (enableWheel && node) {
      node.addEventListener('wheel', handleWheel, { passive: false })
    }

    return () => {
      if (intervalRef.current != null) {
        window.clearInterval(intervalRef.current)
      }
      timelineRef.current?.kill()
      if (node) {
        node.removeEventListener('mouseenter', pause)
        node.removeEventListener('mouseleave', resume)
        node.removeEventListener('wheel', handleWheel)
      }
    }
  }, [
    cardDistance,
    delay,
    enableWheel,
    height,
    pauseOnHover,
    refs,
    skewAmount,
    verticalDistance,
  ])

  const rendered = childArr.map((child, index) => {
    if (!isValidElement(child)) return child

    const element = child as CardElement
    const currentStyle = element.props.style ?? {}
    const style: CSSProperties = { width, height, ...currentStyle }

    return cloneElement(element, {
      key: index,
      ref: refs[index],
      style,
    })
  })

  return (
    <div
      ref={containerRef}
      className='allrouters-card-swap-container'
      style={{ width, height }}
    >
      {rendered}
    </div>
  )
}
