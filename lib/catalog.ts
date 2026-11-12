// lib/catalog.ts
import type { FactorCategory } from '@/lib/db/schema';

export const COMMON_SYMPTOMS = [
  'Headache',
  'Migraine',
  'Fatigue',
  'Nausea',
  'Bloating',
  'Stomach pain',
  'Joint pain',
  'Back pain',
  'Anxiety',
  'Low mood',
  'Brain fog',
  'Dizziness',
  'Insomnia',
  'Cramps',
  'Diarrhea',
  'Constipation',
  'Rash',
  'Heartburn',
];

export const FACTOR_GROUPS: { title: string; items: { name: string; category: FactorCategory }[] }[] = [
  {
    title: 'Food and drink',
    items: [
      { name: 'Dairy', category: 'food' },
      { name: 'Gluten', category: 'food' },
      { name: 'Sugar', category: 'food' },
      { name: 'Fried or fatty food', category: 'food' },
      { name: 'Spicy food', category: 'food' },
      { name: 'Processed food', category: 'food' },
      { name: 'Large meal', category: 'food' },
      { name: 'Skipped meal', category: 'food' },
      { name: 'Caffeine', category: 'drink' },
      { name: 'Alcohol', category: 'drink' },
    ],
  },
  {
    title: 'Body and routine',
    items: [
      { name: 'Poor sleep', category: 'sleep' },
      { name: 'Stress', category: 'stress' },
      { name: 'Exercise', category: 'activity' },
      { name: 'Long screen time', category: 'activity' },
      { name: 'Dehydrated', category: 'other' },
      { name: 'Period', category: 'other' },
      { name: 'Weather change', category: 'other' },
      { name: 'Travel', category: 'activity' },
    ],
  },
];

export const CATEGORY_LABELS: Record<FactorCategory, string> = {
  food: 'Food',
  drink: 'Drink',
  activity: 'Activity',
  sleep: 'Sleep',
  stress: 'Stress',
  medication: 'Medication',
  other: 'Other',
};

export const DURATION_OPTIONS: { label: string; minutes?: number; ongoing?: boolean }[] = [
  { label: 'Not sure' },
  { label: 'Under 15 min', minutes: 10 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 to 4 hours', minutes: 180 },
  { label: 'Most of the day', minutes: 480 },
  { label: 'Still going', ongoing: true },
];
