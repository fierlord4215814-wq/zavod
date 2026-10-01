import { EmployeeState } from '@prisma/client';
import { ConflictError } from '../common/errors/conflict.exception';

const ALLOWED: Record<EmployeeState, EmployeeState[]> = {
  AVAILABLE: [EmployeeState.ASSIGNED, EmployeeState.WASHING, EmployeeState.TIME_ROLE, EmployeeState.OFF_SHIFT],
  ASSIGNED: [EmployeeState.AVAILABLE, EmployeeState.OFF_SHIFT],
  WASHING: [EmployeeState.AVAILABLE, EmployeeState.OFF_SHIFT],
  TIME_ROLE: [EmployeeState.AVAILABLE, EmployeeState.OFF_SHIFT],
  OFF_SHIFT: [EmployeeState.AVAILABLE],
};

export function canTransition(from: EmployeeState, to: EmployeeState): boolean {
  return ALLOWED[from].includes(to);
}

export function assertEmployeeTransition(from: EmployeeState, to: EmployeeState): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(`employee state transition forbidden: ${from} -> ${to}`);
  }
}

export function stateForRelease(): EmployeeState {
  return EmployeeState.AVAILABLE;
}

export function stateForSendHome(): EmployeeState {
  return EmployeeState.OFF_SHIFT;
}
