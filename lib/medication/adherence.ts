// lib/medication/adherence.ts
import type { MedicationSchedule, MedicationAdherence } from '@/lib/db/schema';

export interface AdherenceMetrics {
  adherencePercentage: number;
  totalDoses: number;
  takenDoses: number;
  missedDoses: number;
  skippedDoses: number;
  timingConsistencyMinutes: number | null;
  missedByTimeOfDay: {
    morning: number;
    afternoon: number;
    evening: number;
    night: number;
  };
  missedByWeekday: Record<string, number>;
  skipReasons: Record<string, number>;
}

export function calculateAdherence(
  schedule: MedicationSchedule,
  adherenceRecords: MedicationAdherence[],
  days: number = 30
): AdherenceMetrics {
  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  // Filter records within the time window
  const relevantRecords = adherenceRecords.filter(
    r => new Date(r.scheduledTime) >= cutoffDate && new Date(r.scheduledTime) <= now
  );
  
  // Calculate expected doses
  let expectedDoses = 0;
  if (schedule.frequency !== 'as-needed') {
    const startDate = new Date(Math.max(cutoffDate.getTime(), new Date(schedule.startDate).getTime()));
    const endDate = schedule.endDate ? new Date(Math.min(now.getTime(), new Date(schedule.endDate).getTime())) : now;
    
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expectedDoses = daysDiff * schedule.scheduleTimes.length;
  }
  
  // Count statuses
  const takenDoses = relevantRecords.filter(r => r.status === 'taken').length;
  const missedDoses = relevantRecords.filter(r => r.status === 'missed').length;
  const skippedDoses = relevantRecords.filter(r => r.status === 'skipped').length;
  
  // Calculate adherence percentage
  const totalDoses = Math.max(expectedDoses, relevantRecords.length);
  const adherencePercentage = totalDoses > 0 ? (takenDoses / totalDoses) * 100 : 0;
  
  // Calculate timing consistency (standard deviation in minutes)
  const timingDifferences: number[] = [];
  relevantRecords
    .filter(r => r.status === 'taken' && r.takenTime)
    .forEach(r => {
      const scheduled = new Date(r.scheduledTime);
      const taken = new Date(r.takenTime!);
      const diffMinutes = Math.abs((taken.getTime() - scheduled.getTime()) / (1000 * 60));
      timingDifferences.push(diffMinutes);
    });
  
  let timingConsistencyMinutes: number | null = null;
  if (timingDifferences.length > 1) {
    const mean = timingDifferences.reduce((a, b) => a + b, 0) / timingDifferences.length;
    const variance = timingDifferences.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / timingDifferences.length;
    timingConsistencyMinutes = Math.sqrt(variance);
  }
  
  // Analyze missed doses by time of day
  const missedByTimeOfDay = {
    morning: 0,   // 5am - 11am
    afternoon: 0, // 11am - 5pm
    evening: 0,   // 5pm - 9pm
    night: 0      // 9pm - 5am
  };
  
  relevantRecords
    .filter(r => r.status === 'missed' || r.status === 'skipped')
    .forEach(r => {
      const hour = new Date(r.scheduledTime).getHours();
      if (hour >= 5 && hour < 11) missedByTimeOfDay.morning++;
      else if (hour >= 11 && hour < 17) missedByTimeOfDay.afternoon++;
      else if (hour >= 17 && hour < 21) missedByTimeOfDay.evening++;
      else missedByTimeOfDay.night++;
    });
  
  // Analyze missed doses by weekday
  const missedByWeekday: Record<string, number> = {
    'Sun': 0, 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0
  };
  
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  relevantRecords
    .filter(r => r.status === 'missed' || r.status === 'skipped')
    .forEach(r => {
      const day = weekdays[new Date(r.scheduledTime).getDay()];
      missedByWeekday[day]++;
    });
  
  // Collect skip reasons
  const skipReasons: Record<string, number> = {};
  relevantRecords
    .filter(r => r.status === 'skipped' && r.skipReason)
    .forEach(r => {
      const reason = r.skipReason || 'Unknown';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    });
  
  return {
    adherencePercentage: Math.round(adherencePercentage),
    totalDoses,
    takenDoses,
    missedDoses,
    skippedDoses,
    timingConsistencyMinutes: timingConsistencyMinutes ? Math.round(timingConsistencyMinutes) : null,
    missedByTimeOfDay,
    missedByWeekday,
    skipReasons
  };
}

export function getAdherenceInsights(metrics: AdherenceMetrics): string[] {
  const insights: string[] = [];
  
  // Adherence level insight
  if (metrics.adherencePercentage >= 90) {
    insights.push('Excellent adherence! Keep up the great work.');
  } else if (metrics.adherencePercentage >= 75) {
    insights.push('Good adherence. Consider setting reminders for occasional misses.');
  } else if (metrics.adherencePercentage >= 50) {
    insights.push('Moderate adherence. Discuss barriers with your healthcare provider.');
  } else if (metrics.totalDoses > 0) {
    insights.push('Low adherence. Consider simplifying your medication schedule.');
  }
  
  // Timing consistency insight
  if (metrics.timingConsistencyMinutes !== null) {
    if (metrics.timingConsistencyMinutes <= 30) {
      insights.push('Very consistent timing - excellent routine!');
    } else if (metrics.timingConsistencyMinutes <= 60) {
      insights.push('Good timing consistency.');
    } else {
      insights.push('Variable timing - consider setting alarms.');
    }
  }
  
  // Time of day patterns
  const timeOfDayEntries = Object.entries(metrics.missedByTimeOfDay);
  const maxMissed = Math.max(...timeOfDayEntries.map(([_, count]) => count));
  if (maxMissed > 2) {
    const problemTime = timeOfDayEntries.find(([_, count]) => count === maxMissed)?.[0];
    if (problemTime) {
      insights.push(`Most doses missed in the ${problemTime} - consider adjusting schedule.`);
    }
  }
  
  // Weekday patterns
  const weekdayMisses = Object.values(metrics.missedByWeekday).reduce((a, b) => a + b, 0);
  const weekendMisses = metrics.missedByWeekday['Sat'] + metrics.missedByWeekday['Sun'];
  if (weekdayMisses > 0 && weekendMisses / weekdayMisses > 0.4) {
    insights.push('More misses on weekends - set weekend reminders.');
  }
  
  return insights;
}
