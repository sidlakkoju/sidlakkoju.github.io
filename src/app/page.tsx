import React from 'react';
import { FaYoutube, FaGithub, FaLinkedin } from 'react-icons/fa';
import ProjectCard from './components/ProjectCard';

const Home: React.FC = () => {
  return (
    <div>
      <section className="text-center mt-8">
        <div className="w-60 h-60 rounded-full overflow-hidden mx-auto">
          <img 
            src="/profile-pic.jpeg" 
            alt="Profile Picture" 
            className="w-full h-full object-cover" 
          />
        </div>

        <h1 className="text-5xl mt-4">Sid Lakkoju</h1>
        <p className="text-gray-600 mt-2">Computer Science @ UVA</p>
        <p className="mt-4">The world is pretty cool, lets make it cooler ;)</p>

        <div className="flex justify-center space-x-14 mt-4">
          <a href="https://www.youtube.com/@SidLakkoju" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaYoutube className="text-red-600 w-8 h-8" />
          </a>
          <a href="https://github.com/sidlakkoju" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaGithub className="text-gray-800 dark:text-white w-8 h-8" />
          </a>
          <a href="https://www.linkedin.com/in/siddharthlakkoju/" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaLinkedin className="text-blue-700 w-8 h-8" />
          </a>
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-3xl mb-4">Experience</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            title="MITRE Software Engineer Intern (2022)"
            description="Designed an AR Navigation system all Mitre Campuses using existing internal 2D MapsIndoors maps (no need for precise 3D campus rescanning). Utilized strategically placed reference image (image and pose recognition) in conjunction with Cisco DNA Spaces for precise user localization. Utilized ARKit for iOS and Unity for Android to render and display AR entities."
            mediaUrl="/Mitre_demo.mp4"
            links={[
              { url: 'https://www.mitre.org', type: 'link' },
            ]}
          />
          <ProjectCard
            title="Appian Software Engineer Intern (2023)"
            description= {
              <>
                Implemented Log Based alerting with Grafana Loki to complement the Prometheus metric based alerting. Significantly reduced incident reponse times for situations where metrics weren't sufficient
                <br />
                Developed an LLM assisted internal documentation assistant for Appian Interal docs. User queries are converted to embeddings and then compared to different documentation sections (using cosine similarity formula). Once the most similar/relevant documentation is found, the text is fed into the Llama2-7B-chat model along with the user query allowing for an intuitive chat interface.
              </>
            }
            mediaUrl="appian.png"
            mediaType='image'
            links={[
              { url: 'https://appian.com', type: 'link' }
            ]}
          />
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-3xl mb-4">Projects</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            title="Cavalier Autonomous Racing Perception Engineer"
            description="Description of Project 1"
            mediaUrl="pits.mp4"
            links={[
              { url: 'https://autonomousracing.dev', type: 'link' }
            ]}
            
          />
          <ProjectCard
            title="VTOL"
            description="Description of Project 2"
            mediaUrl="vtol_demo.mp4"
          />
          <ProjectCard
            title="Uvacourseexplorer.com"
            description="Description of Project 2"
            mediaType='image'
            mediaUrl="course_explorer.png"
            links={[
              { url: 'https://github.com/UVA-Course-Explorer', type: 'github' },
              { url: 'https://www.uvacourseexplorer.com', type: 'link' }
            ]}


            
          />
          <ProjectCard
            title="DQN Reinforcement Learning"
            description="Description of Project 2"
            mediaUrl="dqn_demo.mp4"
            links={[
              { url: 'https://github.com/your-github-repo', type: 'github' },
              { url: 'https://youtube.com/your-video-link', type: 'youtube' },
            ]}
          />
          <ProjectCard
            title="Airpods IMU controlled Drone"
            description="Description of Project 2"
            mediaUrl="airpods_control_demo.mp4"
            links={[
              { url: 'https://github.com/sidlakkoju/Airpods-Controlled-Drone', type: 'github' },
              { url: 'https://www.youtube.com/watch?v=3vd3l164FqA', type: 'youtube' },
              { url: 'https://devpost.com/software/raven-tg9ksp', type: 'link' }
            ]}
          />
        </div>
      </section>
    </div>
  );
};

export default Home;
