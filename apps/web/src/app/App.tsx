import { useEffect } from 'react';
import { useRoute } from './router';
import { Library } from '../teacher/Library';
import { Editor } from '../teacher/Editor';
import { Preview } from '../teacher/Preview';
import { StudentHome } from '../student/StudentHome';
import { PlayPage } from '../student/PlayPage';
import { SettingsPage } from './SettingsPage';
import { useOnline } from '../student/ActivityPlayer';
import { UpdateBanner } from './UpdateBanner';

function Home() {
  return (
    <section className="home narrow" aria-labelledby="home-h">
      <h1 id="home-h">Interactive Learning Platform</h1>
      <p className="lede">Create, complete and review interactive learning activities — free, open source, and private by design.</p>
      <div className="role-cards">
        <a className="card role-card" href="#/teacher">
          <h2>I’m a teacher</h2>
          <p>Build activities, preview them as a student, publish versions and share activity files.</p>
        </a>
        <a className="card role-card" href="#/student">
          <h2>I’m a student</h2>
          <p>Open and complete activities. Your work saves on this device as you go.</p>
        </a>
      </div>
      <p className="notice info">
        <strong>Local mode.</strong> This early version has no sign-in and uploads nothing: everything stays in this browser. Google sign-in, class rosters and Drive submissions are planned for Phase 5.
      </p>
    </section>
  );
}

export function App() {
  const { path, query } = useRoute();
  const online = useOnline();
  const [section, a, b] = path;

  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [section, a]);

  let page;
  if (section === 'teacher' && !a) page = <Library />;
  else if (section === 'teacher' && a === 'edit' && b) page = <Editor id={b} />;
  else if (section === 'teacher' && a === 'preview' && b) page = <Preview id={b} as={query.get('as') === 'teacher' ? 'teacher' : 'student'} />;
  else if (section === 'student') page = <StudentHome />;
  else if (section === 'play' && a && b && /^\d+$/.test(b)) page = <PlayPage activityId={a} version={Number(b)} />;
  else if (section === 'settings') page = <SettingsPage />;
  else page = <Home />;

  const area = section === 'teacher' ? 'teacher' : section === 'student' || section === 'play' ? 'student' : section;
  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header className="app-header">
        <a href="#/" className="brand" aria-label="Interactive Learning Platform home">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Interactive Learning</span>
        </a>
        <nav aria-label="Main">
          <a href="#/teacher" aria-current={area === 'teacher' ? 'page' : undefined}>Teacher</a>
          <a href="#/student" aria-current={area === 'student' ? 'page' : undefined}>Student</a>
          <a href="#/settings" aria-current={area === 'settings' ? 'page' : undefined}>Settings</a>
        </nav>
        {!online && <span className="badge warn offline-badge" role="status">Offline</span>}
      </header>
      <UpdateBanner />
      <main id="main" tabIndex={-1}>{page}</main>
    </>
  );
}
