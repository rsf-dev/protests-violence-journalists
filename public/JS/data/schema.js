export const DATA_SCHEMA = {
  authors: [
    {
      id: 'police',
      sourceLabel: "Forces de l'ordre et autorités",
      labelKey: 'actor.policeFull',
      shortKey: 'actor.policeFull',
      color: '#cf304a',
    },
    {
      id: 'other',
      sourceLabel: 'Manifestants ou tiers inconnus',
      labelKey: 'actor.otherFull',
      shortKey: 'actor.otherFull',
      color: '#356fa4',
    },
    {
      id: 'multiple',
      sourceLabel: 'Auteurs multiples ou non établis',
      labelKey: 'actor.multipleFull',
      shortKey: 'actor.multipleFull',
      color: '#7d6f91',
    },
  ],
  violenceTypes: [
    {
      id: 'physical',
      sourceLabel: 'Violence physique',
      labelKey: 'type.physical',
      shortKey: 'type.physicalShort',
      color: '#223943',
    },
    {
      id: 'arrest',
      sourceLabel: 'Arrestation / détention',
      labelKey: 'type.arrest',
      shortKey: 'type.arrestShort',
      color: '#8a634b',
    },
    {
      id: 'verbal',
      sourceLabel: 'Menace ou intimidation',
      labelKey: 'type.verbal',
      shortKey: 'type.verbalShort',
      color: '#bf9129',
    },
    {
      id: 'unspecified',
      sourceLabel: 'Autre ou non précisé',
      labelKey: 'type.unspecified',
      shortKey: 'type.unspecifiedShort',
      color: '#929ca5',
    },
    {
      id: 'obstruction',
      sourceLabel: 'Entrave, fouille ou contrôle abusifs',
      labelKey: 'type.obstruction',
      shortKey: 'type.obstructionShort',
      color: '#277e92',
    },
    {
      id: 'seizure',
      sourceLabel: 'Saisie, dégradation ou vol de matériel',
      labelKey: 'type.seizure',
      shortKey: 'type.seizureShort',
      color: '#4e897a',
    },
  ],
};

// Liste fermée : aucun champ individuel ou de provenance ne peut être publié.
export const PUBLIC_DATA_FIELDS = {
  root: ['metadata', 'records', 'typical'],
  metadata: [
    'schemaVersion',
    'anonymized',
    'synthetic',
    'unit',
    'year',
    'years',
    'cases',
    'countries',
    'authors',
    'violenceTypes',
    'typical',
  ],
  catalog: ['id', 'labelKey', 'shortKey', 'color', 'count'],
  record: ['id', 'country', 'countryCode', 'year', 'author', 'violenceType'],
  point: ['id', 'author', 'violenceType', 'representative', 'typicalOrder'],
  typical: ['size', 'method'],
};
