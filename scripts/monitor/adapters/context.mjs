let sourceByCompany = new Map();

export function configureAdapterContext(targets) {
  sourceByCompany = new Map(targets.map((target) => [target.company, target]));
}

export function sourceForCompany(company) {
  return sourceByCompany.get(company);
}

