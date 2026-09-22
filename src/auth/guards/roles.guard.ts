import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from 'src/common/decorators/roles.decorator';

// Define interface untuk Request yang membawa Payload User
interface RequestWithUser extends Request {
  user?: {
    id?: string;
    userId?: string;
    username?: string;
    role?: Role;
    kotamaId?: string | null;
    satminkalId?: string | null;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user || !user.role) {
      return false;
    }

    // 1. Super Admin has universal access to all endpoints
    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    // 2. Admin Kotama has access if requiredRoles includes ADMIN_KOTAMA or admin koperasi/satminkal
    if (user.role === Role.ADMIN_KOTAMA) {
      if (
        requiredRoles.includes(Role.ADMIN_KOTAMA) ||
        requiredRoles.includes(Role.ADMIN_KOPERASI) ||
        requiredRoles.includes(Role.ADMIN_SATMINKAL)
      ) {
        return true;
      }
    }

    // 3. Admin Satminkal / Admin Koperasi has universal access to satminkal-level management
    if (
      user.role === Role.ADMIN_KOPERASI ||
      user.role === Role.ADMIN_SATMINKAL
    ) {
      if (
        requiredRoles.includes(Role.ADMIN_KOPERASI) ||
        requiredRoles.includes(Role.ADMIN_SATMINKAL)
      ) {
        return true;
      }
      return true;
    }

    return requiredRoles.includes(user.role);
  }
}

