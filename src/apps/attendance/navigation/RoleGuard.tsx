/**
 * RoleGuard.tsx
 * -----------------------------------------------------------------------------
 * Renders a screen only if the device holds the required role.
 *
 * The tab trees are already role-separated, so in normal use this never
 * triggers. It exists for the abnormal paths: a deep link, a restored
 * navigation state from a previous role, a stale screen still mounted while the
 * role changes underneath it, or a future refactor wiring a screen into the
 * wrong tree.
 *
 * This is the RENDER-level guard. It is not the security boundary on its own —
 * the real enforcement is in RoleService's assertHost / assertEmployee, which
 * sit inside the BLE start paths and cannot be bypassed by any navigation
 * trick. This layer just avoids showing a screen that would be useless or
 * misleading.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { View } from 'react-native';
import type { AppRole } from '../constants/appConfig';
import { EmptyState } from '../components/states';
import { Screen } from '../components/ui';
import { useAppStore } from '../state/appStore';

export function RoleGuard({
  requiredRole,
  children,
}: {
  requiredRole: AppRole;
  children: React.ReactNode;
}) {
  const store = useAppStore();
  const role = store.settings.role;

  if (role === requiredRole) {
    return <>{children}</>;
  }

  return (
    <Screen>
      <EmptyState
        icon="ban"
        title={
          requiredRole === 'HOST'
            ? 'Host feature'
            : 'Employee feature'
        }
        message={
          requiredRole === 'HOST'
            ? 'This screen is part of Host mode. This device is set up as an Employee, so attendance scanning and employee management are not available here.'
            : 'This screen is part of Employee mode. This device is set up as the Host.'
        }
      />
      <View />
    </Screen>
  );
}

/** Convenience wrappers so screens read clearly in the navigator. */
export function HostOnly({ children }: { children: React.ReactNode }) {
  return <RoleGuard requiredRole="HOST">{children}</RoleGuard>;
}

export function EmployeeOnly({ children }: { children: React.ReactNode }) {
  return <RoleGuard requiredRole="EMPLOYEE">{children}</RoleGuard>;
}
