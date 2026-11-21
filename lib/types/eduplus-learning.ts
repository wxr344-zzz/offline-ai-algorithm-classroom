import type { ClassroomRecord } from '@/lib/eduplus/classroom-contract';
import type { PublicCourse } from './eduplus.generated';
export interface PracticeEventInput {
  eventId: string;
  sceneId: string;
  problemVersion: number;
  status: 'completed' | 'stopped' | 'error';
  passed: number;
  total: number;
  draftRevision: number | null;
  message: string;
}
export interface PracticeEvent extends PracticeEventInput {
  createdAt: string;
  source: 'browser-practice';
}
export interface ClassroomResponse extends ClassroomRecord {
  course: PublicCourse;
}
export interface LearningReview {
  courseId: string;
  events: PracticeEvent[];
  drafts: Array<{
    sceneId: string;
    sceneType: 'guided-lab' | 'oj-lab';
    revision: number;
    updatedAt: string | null;
  }>;
  quiz: null | { total: number; correct: number; submittedAt: string; wrongTopics: string[] };
  quizStatus: 'not-created' | 'not-submitted' | 'scored' | 'content-changed';
  dialogue: Array<{ id: string; sender: string; text: string; sceneId: string | null }>;
}
