import { ArtistAvatar, ArtistLink } from '../components/bits'
import { PHOTO_CREDITS } from '../lib/artistAvatar'
import { SITE_NAME } from '../lib/site'

/**
 * Attribution for the public demo's artist photos. They come from Wikimedia
 * Commons, mostly under CC BY / CC BY-SA, which require naming the author,
 * the licence and the source — this page is where that obligation is met.
 * The real site's portraits are official art and have no credits file, so the
 * page is only routed in the demo.
 */
export default function Credits() {
  return (
    <div>
      <h1>Credits</h1>
      <p className="subtitle">
        {SITE_NAME} is a demo: the scores are real, but every ranker, song and artist has been swapped for a stand-in.
        The artist photos come from Wikimedia Commons, used under the licences below.
      </p>
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>Artist</th>
              <th>Photo</th>
              <th>Author</th>
              <th>Licence</th>
            </tr>
          </thead>
          <tbody>
            {PHOTO_CREDITS.map((c) => (
              <tr key={c.artist}>
                <td>
                  <span className="name-with-avatar">
                    <ArtistAvatar a={c.artist} size={28} />
                    <ArtistLink a={c.artist} />
                  </span>
                </td>
                <td>
                  <a href={c.source} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                </td>
                <td>{c.author}</td>
                <td>
                  {c.licenseUrl ? (
                    <a href={c.licenseUrl} target="_blank" rel="noreferrer">
                      {c.license}
                    </a>
                  ) : (
                    c.license
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Photos are cropped to a square. Inclusion implies no endorsement by the artists or photographers.</p>
    </div>
  )
}
