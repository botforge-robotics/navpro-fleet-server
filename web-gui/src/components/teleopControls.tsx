import Box from '@mui/material/Box';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const DEADZONE = 0.08;
const TELEOP_MAX_LINEAR = 0.15;
const TELEOP_MAX_ANGULAR = 1.5;

export function TeleopJoystick({
  disabled,
  onMove,
  size = 140,
}: {
  disabled: boolean;
  onMove: (linear: number, angular: number) => void;
  size?: number;
}): ReactElement {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const emitFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = areaRef.current;
      if (!el || disabled) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = Math.min(rect.width, rect.height) / 2 - 8;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 0) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      setKnob({ x: dx, y: dy });
      let linear = Math.max(-1, Math.min(1, -dy / maxR)) * TELEOP_MAX_LINEAR;
      let angular = Math.max(-1, Math.min(1, -dx / maxR)) * TELEOP_MAX_ANGULAR;
      if (
        Math.abs(linear) < DEADZONE * TELEOP_MAX_LINEAR &&
        Math.abs(angular) < DEADZONE * TELEOP_MAX_ANGULAR
      ) {
        linear = 0;
        angular = 0;
      }
      onMoveRef.current(linear, angular);
    },
    [disabled],
  );

  const stop = useCallback(() => {
    active.current = false;
    setKnob({ x: 0, y: 0 });
    onMoveRef.current(0, 0);
  }, []);

  useEffect(() => {
    const onUp = (): void => {
      if (active.current) stop();
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [stop]);

  const knobSize = Math.round(size * 0.32);

  return (
    <Box
      ref={areaRef}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid',
        borderColor: disabled ? 'divider' : 'primary.main',
        bgcolor: 'action.hover',
        position: 'relative',
        touchAction: 'none',
        opacity: disabled ? 0.4 : 1,
        userSelect: 'none',
        mx: 'auto',
        flexShrink: 0,
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        active.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        emitFromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!active.current) return;
        emitFromPointer(e.clientX, e.clientY);
      }}
      onPointerUp={() => stop()}
      onLostPointerCapture={() => stop()}
    >
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: knobSize,
          height: knobSize,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          boxShadow: 2,
        }}
      />
    </Box>
  );
}

export function useRobotTeleop(robotId: string | null, active: boolean) {
  const teleopRef = useRef({ linear: 0, angular: 0 });
  const [cmd, setCmd] = useState({ linear: 0, angular: 0 });

  const postTeleop = useCallback(
    (linear: number, angular: number) => {
      if (!robotId) return;
      void api
        .post(`/api/v1/robots/${robotId}/teleop`, { linear, angular })
        .catch(() => undefined);
    },
    [robotId],
  );

  useEffect(() => {
    if (!active || !robotId) return;
    const id = window.setInterval(() => {
      const { linear, angular } = teleopRef.current;
      if (linear !== 0 || angular !== 0) {
        postTeleop(linear, angular);
      }
    }, 50);
    return () => {
      window.clearInterval(id);
      teleopRef.current = { linear: 0, angular: 0 };
      postTeleop(0, 0);
    };
  }, [active, robotId, postTeleop]);

  const onJoystick = useCallback(
    (linear: number, angular: number) => {
      const prev = teleopRef.current;
      teleopRef.current = { linear, angular };
      setCmd({ linear, angular });
      if (linear === 0 && angular === 0) {
        postTeleop(0, 0);
      } else if (prev.linear === 0 && prev.angular === 0) {
        postTeleop(linear, angular);
      }
    },
    [postTeleop],
  );

  const stop = useCallback(() => {
    teleopRef.current = { linear: 0, angular: 0 };
    setCmd({ linear: 0, angular: 0 });
    postTeleop(0, 0);
  }, [postTeleop]);

  return { cmd, onJoystick, stop, postTeleop };
}
