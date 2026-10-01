export type UserScope =
  | { type: 'FACTORY'; factoryId: string; departmentId?: string | null }
  | { type: 'GLOBAL'; factoryId?: string | null; departmentId?: string | null }
  | { type: 'GUEST'; factoryId?: string | null };

export type UserContext = {
  userId: string;
  selectedFactoryId: string;
  role: string;
  departmentId: string | null;
  companyId: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGuest: boolean;
  scope: UserScope;

  /**
   * Compatibility aliases for the early prototype services.
   * New code should prefer userId and selectedFactoryId.
   */
  id: string;
  factoryId: string;
};

export type RequestWithUserContext = {
  headers: Record<string, string | string[] | undefined>;
  user: UserContext;
};
