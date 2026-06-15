import { Injectable } from '@nestjs/common';

import * as studentsQueries from '../queries/students.queries';
import { BaseRepository } from './base.repository';

@Injectable()
export class StudentsRepository extends BaseRepository {
  findById(clientId: string, studentId: string) {
    return studentsQueries.getStudentById(this.db, studentId, clientId);
  }

  listByClient(clientId: string) {
    return studentsQueries.listStudentsByClient(this.db, clientId);
  }

  create(values: Parameters<typeof studentsQueries.insertStudent>[1]) {
    return studentsQueries.insertStudent(this.db, values);
  }

  update(
    studentId: string,
    clientId: string,
    data: Parameters<typeof studentsQueries.updateStudent>[3],
  ) {
    return studentsQueries.updateStudent(this.db, studentId, clientId, data);
  }
}
