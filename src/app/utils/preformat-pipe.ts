import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'preformat',
  standalone: true
})
export class PreformatPipe implements PipeTransform {
  transform(value: string | undefined | null): string {
    if (!value) return '';
    // Substitui quebras de linha por <br> e espaços por &nbsp;
    return value
      .replace(/\n/g, '<br>')
      .replace(/  /g, '&nbsp; ');
  }
}